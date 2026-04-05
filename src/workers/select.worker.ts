import { Worker } from 'bullmq';
import { connection, queues } from '../queue/queues.js';
import { prisma } from '../db/client.js';

// TODO (Week 2): Replace stub with full ViralDetectorAgent + ClipSelectorAgent
export const selectWorker = new Worker(
  'select',
  async (job) => {
    const { sourceId, transcriptPath, outputDir } = job.data;

    console.log(`[select] Starting clip selection for source ${sourceId}`);
    console.log(`[select] Transcript: ${transcriptPath}`);

    // Stub: log and fan out to reframe with empty selections
    // Real implementation: run deterministic prescreener → Claude API scoring → resolve timestamps
    console.log(`[select] ⚠️  Stub — no clips selected yet. Implement ViralDetectorAgent in Week 2.`);

    // Fan out to reframe (will be triggered per approved clip in real flow)
    // For now, log that we're waiting for approval
    console.log(`[select] Waiting for user approval of clip selections.`);
  },
  {
    connection,
    concurrency: 2,
  }
);

selectWorker.on('failed', (job, err) => {
  console.error(`[select] Job ${job?.id} failed:`, err.message);
});
