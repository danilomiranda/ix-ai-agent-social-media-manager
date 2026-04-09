import { Worker } from 'bullmq';
import { spawn } from 'child_process';
import path from 'path';
import { connection, queues } from '../queue/queues.js';
import { prisma } from '../db/client.js';
import { assertSafeOutputDir } from './utils.js';

function spawnAsync(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    const outLines: string[] = [];
    const errLines: string[] = [];
    proc.stdout.on('data', (d: Buffer) => { const s = d.toString(); process.stdout.write(s); outLines.push(s); });
    proc.stderr.on('data', (d: Buffer) => { const s = d.toString(); process.stderr.write(s); errLines.push(s); });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const detail = errLines.join('').trim() || outLines.join('').trim() || `exit code ${code}`;
        reject(new Error(`Process exited with code ${code}: ${detail.slice(0, 500)}`));
      }
    });
    proc.on('error', reject);
  });
}

export const transcribeWorker = new Worker(
  'transcribe',
  async (job) => {
    const { sourceId, sourcePath, outputDir } = job.data;
    const root = path.resolve('.');

    assertSafeOutputDir(outputDir);
    console.log(`[transcribe] Starting job ${job.id} for ${sourcePath}`);

    await prisma.job.update({
      where: { id: job.data.jobId },
      data: { status: 'running', startedAt: new Date() },
    });

    await spawnAsync('python3', [
      '-m', 'transcriber',
      '--video', sourcePath,
      '--output', outputDir,
    ], path.join(root, 'python'));

    await prisma.job.update({
      where: { id: job.data.jobId },
      data: { status: 'done', completedAt: new Date(), output: JSON.stringify({ outputDir }) },
    });

    // Fan out to select worker
    await queues.select.add('clip-select', {
      sourceId,
      sourcePath,
      transcriptPath: path.join(outputDir, 'transcript.srt'),
      wordsJsonPath: path.join(outputDir, 'transcript.words.json'),
      outputDir,
    });

    console.log(`[transcribe] Done — enqueued clip-select for source ${sourceId}`);
  },
  {
    connection,
    concurrency: 2,
  }
);

transcribeWorker.on('failed', async (job, err) => {
  console.error(`[transcribe] Job ${job?.id} failed:`, err.message);
  if (job?.data?.jobId) {
    await prisma.job.update({
      where: { id: job.data.jobId },
      data: { status: 'failed', error: err.message, completedAt: new Date() },
    });
  }
});
