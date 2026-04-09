import { Worker } from 'bullmq';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { connection, queues } from '../queue/queues.js';
import { prisma } from '../db/client.js';
import { assertSafeOutputDir } from './utils.js';
import { runVideoEditorAgent } from '../agents/video-editor.js';
import type { TranscriptWord } from '../agents/prescreener.js';

function spawnAsync(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Process exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

export const editWorker = new Worker(
  'edit',
  async (job) => {
    const { dbJobId, clipId, reframedPath, outputDir, platforms, caption } = job.data;
    const root = path.resolve('.');

    assertSafeOutputDir(outputDir);
    console.log(`[edit] Starting edit for clip ${clipId}`);

    if (dbJobId) {
      await prisma.job.update({
        where: { id: dbJobId },
        data: { status: 'running', startedAt: new Date() },
      });
    }

    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      select: { title: true, transcriptExcerpt: true, startSec: true, endSec: true },
    });
    if (!clip) throw new Error(`Clip ${clipId} not found`);

    // Derive compositionId from clipId
    const compositionId = `Clip${clipId.slice(0, 8).replace(/-/g, '')}`;
    const compositionFile = path.resolve('remotion', 'compositions', `${compositionId}.tsx`);
    const wordsFile = path.resolve('remotion', 'data', `${compositionId.toLowerCase()}-words.ts`);

    const alreadyExists = await fs.access(compositionFile).then(() => true).catch(() => false);

    if (!alreadyExists) {
      // Read word-level transcript
      const wordsPath = path.join(outputDir, 'transcript.words.json');
      let wordsJson: TranscriptWord[] = [];
      try {
        wordsJson = JSON.parse(await fs.readFile(wordsPath, 'utf-8'));
      } catch {
        console.warn(`[edit] transcript.words.json not found at ${wordsPath} — continuing with empty words`);
      }

      const durationSec = clip.endSec != null && clip.startSec != null
        ? clip.endSec - clip.startSec
        : 60;

      const editorOutput = await runVideoEditorAgent({
        compositionId,
        clipTitle: clip.title ?? compositionId,
        durationSec,
        transcriptExcerpt: clip.transcriptExcerpt ?? '',
        wordsJson,
        reframedVideoPath: path.relative(root, reframedPath),
      });

      await fs.mkdir(path.resolve('remotion', 'compositions'), { recursive: true });
      await fs.mkdir(path.resolve('remotion', 'data'), { recursive: true });
      await fs.writeFile(compositionFile, editorOutput.tsxContent, 'utf-8');
      await fs.writeFile(wordsFile, editorOutput.wordsContent, 'utf-8');

      console.log(`[edit] Wrote composition ${compositionId}.tsx and words file`);
    } else {
      console.log(`[edit] Composition ${compositionId}.tsx already exists — skipping generation`);
    }

    const outputPath = path.join(outputDir, 'edited.mp4');

    await spawnAsync('npx', [
      'remotion', 'render',
      'remotion/index.ts',
      compositionId,
      outputPath,
    ], root);

    await prisma.clip.update({
      where: { id: clipId },
      data: { editedPath: outputPath },
    });

    if (dbJobId) {
      await prisma.job.update({
        where: { id: dbJobId },
        data: { status: 'done', completedAt: new Date(), output: JSON.stringify({ editedPath: outputPath }) },
      });
    }

    await queues.publish.add('publish-clip', {
      clipId,
      editedPath: outputPath,
      platforms: platforms ?? ['tiktok', 'instagram'],
      caption,
    });

    console.log(`[edit] Done — enqueued publish for clip ${clipId}`);
  },
  {
    connection,
    concurrency: 2,
  }
);

editWorker.on('failed', async (job, err) => {
  console.error(`[edit] Job ${job?.id} failed:`, err.message);
  const dbJobId = job?.data?.dbJobId;
  if (dbJobId) {
    await prisma.job.update({
      where: { id: dbJobId },
      data: { status: 'failed', error: err.message, completedAt: new Date() },
    });
  }
});
