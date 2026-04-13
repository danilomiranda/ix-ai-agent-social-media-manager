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
    const { dbJobId, clipId, reframedPath, outputDir, wordsJsonPath, platforms, caption } = job.data;
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

    // Copy reframed video to public/pipeline-clips/<clipId>/reframed.mp4 (URL-safe, served by Remotion)
    const publicClipDir = path.resolve('public', 'pipeline-clips', clipId);
    const publicVideoPath = path.join(publicClipDir, 'reframed.mp4');
    const staticFilePath = `pipeline-clips/${clipId}/reframed.mp4`; // path for staticFile()
    await fs.mkdir(publicClipDir, { recursive: true });
    await fs.copyFile(reframedPath, publicVideoPath);

    const alreadyExists = await fs.access(compositionFile).then(() => true).catch(() => false);

    if (!alreadyExists) {
      // Read word-level transcript (passed from transcribe → select → reframe → edit)
      let wordsJson: TranscriptWord[] = [];
      if (wordsJsonPath) {
        try {
          wordsJson = JSON.parse(await fs.readFile(wordsJsonPath, 'utf-8'));
        } catch {
          console.warn(`[edit] transcript.words.json not found at ${wordsJsonPath} — continuing with empty words`);
        }
      }

      const startSec = clip.startSec ?? 0;
      const endSec = clip.endSec ?? startSec + 60;
      const durationSec = endSec - startSec;

      // Filter words to clip time range and normalize timestamps to clip-relative seconds
      const clipWords = wordsJson
        .filter(w => w.start >= startSec && w.end <= endSec)
        .map(w => ({ ...w, start: parseFloat((w.start - startSec).toFixed(3)), end: parseFloat((w.end - startSec).toFixed(3)) }));

      const editorOutput = await runVideoEditorAgent({
        compositionId,
        clipTitle: clip.title ?? compositionId,
        durationSec,
        transcriptExcerpt: clip.transcriptExcerpt ?? '',
        wordsJson: clipWords,
        reframedVideoPath: staticFilePath,
      });

      await fs.mkdir(path.resolve('remotion', 'compositions'), { recursive: true });
      await fs.mkdir(path.resolve('remotion', 'data'), { recursive: true });
      await fs.writeFile(compositionFile, editorOutput.tsxContent, 'utf-8');
      await fs.writeFile(wordsFile, editorOutput.wordsContent, 'utf-8');

      // Register composition in Root.tsx
      const rootFile = path.resolve('remotion', 'Root.tsx');
      let rootSrc = await fs.readFile(rootFile, 'utf-8');
      const importLine = `import { ${editorOutput.compositionName} } from './compositions/${compositionId}';\n`;
      const compositionBlock = `\n      <Composition\n        id="${editorOutput.compositionName}"\n        component={${editorOutput.compositionName}}\n        durationInFrames={${editorOutput.totalDurationFrames}}\n        fps={VIDEO_FPS}\n        width={RESOLUTIONS.portrait.width}\n        height={RESOLUTIONS.portrait.height}\n      />`;
      if (!rootSrc.includes(importLine.trim())) {
        rootSrc = rootSrc.replace('import { VIDEO_FPS', `${importLine}import { VIDEO_FPS`);
        rootSrc = rootSrc.replace('    </>\n  );\n};', `${compositionBlock}\n    </>\n  );\n};`);
        await fs.writeFile(rootFile, rootSrc, 'utf-8');
        console.log(`[edit] Registered ${editorOutput.compositionName} in Root.tsx`);
      }

      console.log(`[edit] Wrote composition ${compositionId}.tsx and words file`);
    } else {
      // Check if registered — if not, delete and regenerate
      const rootFile = path.resolve('remotion', 'Root.tsx');
      const rootSrc = await fs.readFile(rootFile, 'utf-8');
      if (!rootSrc.includes(`"${compositionId}"`)) {
        console.log(`[edit] ${compositionId} exists but not registered in Root.tsx — deleting for regeneration`);
        await fs.unlink(compositionFile).catch(() => {});
        await fs.unlink(wordsFile).catch(() => {});
        // Throw so BullMQ retries and hits the generation branch
        throw new Error(`${compositionId} not registered — deleted for regeneration, please retry`);
      }
      console.log(`[edit] Composition ${compositionId}.tsx already exists and registered — skipping generation`);
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
