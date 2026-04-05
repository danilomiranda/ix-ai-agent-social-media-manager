import { Worker } from 'bullmq';
import { spawn } from 'child_process';
import path from 'path';
import { connection, queues } from '../queue/queues.js';
import { prisma } from '../db/client.js';

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
    const { clipId, compositionId, outputPath } = job.data;
    const root = path.resolve('.');

    console.log(`[edit] Starting Remotion render for clip ${clipId}`);

    // TODO (Week 2): Generate .tsx composition via VideoEditorAgent before rendering
    // For now, requires compositionId to already exist in remotion/compositions/
    if (!compositionId) {
      console.log(`[edit] ⚠️  Stub — no compositionId provided. Implement VideoEditorAgent in Week 2.`);
      return;
    }

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

    // Fan out to publish worker
    await queues.publish.add('publish-clip', {
      clipId,
      editedPath: outputPath,
    });

    console.log(`[edit] Done — enqueued publish for clip ${clipId}`);
  },
  {
    connection,
    concurrency: 2,
  }
);

editWorker.on('failed', (job, err) => {
  console.error(`[edit] Job ${job?.id} failed:`, err.message);
});
