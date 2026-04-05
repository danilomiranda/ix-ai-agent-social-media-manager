import chokidar from 'chokidar';
import path from 'path';
import { queues } from '../queue/queues.js';
import { prisma } from '../db/client.js';

const INPUT_DIR = path.resolve('input');
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv'];

export function startWatcher() {
  const watcher = chokidar.watch(INPUT_DIR, {
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
  });

  watcher.on('add', async (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (!VIDEO_EXTENSIONS.includes(ext)) return;

    console.log(`[watcher] New video detected: ${filePath}`);

    const fileName = path.basename(filePath, ext);
    const outputDir = path.resolve('output', 'clips', `${new Date().toISOString().slice(0, 10)}-${fileName}`);

    // Create Source record
    const source = await prisma.source.create({
      data: {
        type: 'local_file',
        filePath,
        title: fileName,
        initiative: 'social_engine',
        status: 'pending',
      },
    });

    // Create Job record
    const job = await prisma.job.create({
      data: {
        sourceId: source.id,
        type: 'transcribe',
        status: 'queued',
        input: JSON.stringify({ filePath, outputDir }),
      },
    });

    // Enqueue transcription
    await queues.transcribe.add('transcribe', {
      jobId: job.id,
      sourceId: source.id,
      sourcePath: filePath,
      outputDir,
    });

    console.log(`[watcher] Enqueued transcribe job ${job.id} for source ${source.id}`);
  });

  watcher.on('error', (err) => {
    console.error('[watcher] Error:', err);
  });

  console.log(`[watcher] Watching ${INPUT_DIR} for video files...`);
  return watcher;
}
