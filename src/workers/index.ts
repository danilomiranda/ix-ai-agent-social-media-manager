import { transcribeWorker } from './transcribe.worker.js';
import { selectWorker } from './select.worker.js';
import { reframeWorker } from './reframe.worker.js';
import { editWorker } from './edit.worker.js';
import { publishWorker } from './publish.worker.js';

console.log('Workers started. Listening on queues: transcribe, select, reframe, edit, publish');

// Graceful shutdown
const workers = [transcribeWorker, selectWorker, reframeWorker, editWorker, publishWorker];

process.on('SIGTERM', async () => {
  console.log('SIGTERM received — shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received — shutting down workers...');
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
});
