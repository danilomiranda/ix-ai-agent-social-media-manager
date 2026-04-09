import { Worker } from 'bullmq';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { connection, queues } from '../queue/queues.js';
import { prisma } from '../db/client.js';
import { assertSafeOutputDir } from './utils.js';

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

export const reframeWorker = new Worker(
  'reframe',
  async (job) => {
    const { dbJobId, clipId, sourcePath, clipDefinitionsPath, outputDir } = job.data;
    const root = path.resolve('.');

    assertSafeOutputDir(outputDir);
    console.log(`[reframe] Starting reframe for clip ${clipId}`);

    // Look up clip to get sourceId for Job record
    const clip = await prisma.clip.findUnique({ where: { id: clipId }, select: { sourceId: true } });
    if (!clip) throw new Error(`Clip ${clipId} not found`);

    // Update or create Job record at start
    if (dbJobId) {
      await prisma.job.update({
        where: { id: dbJobId },
        data: { status: 'running', startedAt: new Date() },
      });
    }

    await spawnAsync('python3', [
      '-m', 'clip_extractor', 'batch',
      '--video', sourcePath,
      '--clips', clipDefinitionsPath,
      '--output', outputDir,
    ], path.join(root, 'tools'));

    const reframedPath = path.join(outputDir, 'reframed-9x16.mp4');

    await prisma.clip.update({
      where: { id: clipId },
      data: { filePath: reframedPath },
    });

    if (dbJobId) {
      await prisma.job.update({
        where: { id: dbJobId },
        data: {
          status: 'done',
          completedAt: new Date(),
          output: JSON.stringify({ reframedPath }),
        },
      });
    }

    // Fan out to edit worker
    await queues.edit.add('edit-clip', {
      clipId,
      reframedPath,
      outputDir,
    });

    console.log(`[reframe] Done — enqueued edit for clip ${clipId}`);
  },
  {
    connection,
    concurrency: 1, // Face tracking is CPU/GPU intensive — one at a time
  }
);

reframeWorker.on('failed', async (job, err) => {
  console.error(`[reframe] Job ${job?.id} failed:`, err.message);
  const dbJobId = job?.data?.dbJobId;
  if (dbJobId) {
    await prisma.job.update({
      where: { id: dbJobId },
      data: { status: 'failed', error: err.message, completedAt: new Date() },
    });
  }
});
