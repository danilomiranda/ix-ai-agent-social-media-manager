import { Worker } from 'bullmq';
import fs from 'fs/promises';
import path from 'path';
import { connection, queues } from '../queue/queues.js';
import { prisma } from '../db/client.js';
import { segmentTranscript, prescreenSegments } from '../agents/prescreener.js';
import type { TranscriptWord } from '../agents/prescreener.js';
import { runViralDetectorAgent } from '../agents/viral-detector.js';
import { resolveTimestamps } from '../agents/timestamp-resolver.js';

function slugify(s: string): string {
  return s
    .replace(/[^\x00-\x7F]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export const selectWorker = new Worker(
  'select',
  async (job) => {
    const { sourceId, sourcePath, transcriptPath, wordsJsonPath, outputDir, jobId } = job.data;

    console.log(`[select] Starting clip selection for source ${sourceId}`);

    if (jobId) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'running', startedAt: new Date() },
      });
    }

    // Read word-level transcript
    const raw = await fs.readFile(wordsJsonPath, 'utf-8');
    const words: TranscriptWord[] = JSON.parse(raw);

    if (words.length === 0) {
      console.log('[select] Empty transcript — no clips to select');
      if (jobId) await prisma.job.update({ where: { id: jobId }, data: { status: 'done', completedAt: new Date() } });
      return;
    }

    // Phase 1: deterministic prescreener
    const segments = segmentTranscript(words);
    const prescreened = prescreenSegments(segments, 20);

    if (prescreened.length === 0) {
      console.log('[select] No segments passed prescreener — no clips created');
      if (jobId) await prisma.job.update({ where: { id: jobId }, data: { status: 'done', completedAt: new Date() } });
      return;
    }

    console.log(`[select] Prescreener passed ${prescreened.length} segments to ViralDetectorAgent`);

    // Phase 2: Claude API scoring
    const scored = await runViralDetectorAgent(prescreened);

    if (scored.length === 0) {
      console.log('[select] ViralDetectorAgent found no viral clips');
      if (jobId) await prisma.job.update({ where: { id: jobId }, data: { status: 'done', completedAt: new Date() } });
      return;
    }

    // Phase 3: resolve timestamps
    const videoDurationSec = words[words.length - 1]?.end ?? 0;
    const resolved = resolveTimestamps(scored, prescreened, videoDurationSec);

    console.log(`[select] Resolved ${resolved.length} clips — creating DB records`);

    // Create Clip records + enqueue reframe per clip
    for (const clip of resolved) {
      const clipOutputDir = path.resolve(
        'output', 'clips',
        `${new Date().toISOString().slice(0, 10)}-${slugify(clip.title)}`
      );
      const clipDefsPath = path.join(clipOutputDir, 'clip_definitions.json');

      await fs.mkdir(clipOutputDir, { recursive: true });

      const dbClip = await prisma.clip.create({
        data: {
          sourceId,
          title: clip.title,
          startSec: clip.startSec,
          endSec: clip.endSec,
          hookStrength: clip.hookStrength,
          valueDelivery: clip.valueDelivery,
          clarity: clip.clarity,
          shareability: clip.shareability,
          completeness: clip.completeness,
          totalScore: clip.totalScore,
          category: clip.category,
          transcriptExcerpt: clip.transcriptExcerpt,
          approved: false, // NEVER auto-approve
        },
      });

      await fs.writeFile(clipDefsPath, JSON.stringify([{
        id: dbClip.id,
        start: clip.startSec,
        end: clip.endSec,
        title: clip.title,
      }]));

      const dbJob = await prisma.job.create({
        data: {
          sourceId,
          type: 'reframe',
          status: 'queued',
          input: JSON.stringify({ clipId: dbClip.id, outputDir: clipOutputDir }),
        },
      });

      await queues.reframe.add('reframe-clip', {
        dbJobId: dbJob.id,
        clipId: dbClip.id,
        sourcePath,
        clipDefinitionsPath: clipDefsPath,
        outputDir: clipOutputDir,
      });
    }

    console.log(`[select] Created ${resolved.length} clips, enqueued reframe jobs`);

    if (jobId) {
      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'done', completedAt: new Date(), output: JSON.stringify({ clipsCreated: resolved.length }) },
      });
    }
  },
  {
    connection,
    concurrency: 2,
  }
);

selectWorker.on('failed', async (job, err) => {
  console.error(`[select] Job ${job?.id} failed:`, err.message);
  const jobId = job?.data?.jobId;
  if (jobId) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'failed', error: err.message, completedAt: new Date() },
    });
  }
});
