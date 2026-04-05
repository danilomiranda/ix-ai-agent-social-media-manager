import { Worker } from 'bullmq';
import axios from 'axios';
import { connection } from '../queue/queues.js';
import { prisma } from '../db/client.js';
import { config } from '../config.js';

const LATE_API = 'https://getlate.dev/api/v1';

export const publishWorker = new Worker(
  'publish',
  async (job) => {
    const { clipId, platforms, caption, title, hashtags } = job.data;

    console.log(`[publish] Starting publish for clip ${clipId} → ${platforms?.join(', ')}`);

    // TODO (Week 3): Implement full Late API publish flow
    // 1. Upload edited mp4 to Zernio presigned URL
    // 2. POST /posts with platform array + copy
    console.log(`[publish] ⚠️  Stub — implement full Late API publish in Week 3.`);

    // Stub: mark post as 'draft'
    await prisma.post.create({
      data: {
        clipId,
        platform: platforms?.[0] ?? 'unknown',
        caption,
        title,
        hashtags: hashtags ? JSON.stringify(hashtags) : null,
        status: 'draft',
      },
    });

    console.log(`[publish] Draft post created for clip ${clipId}`);
  },
  {
    connection,
    concurrency: 3,
  }
);

publishWorker.on('failed', (job, err) => {
  console.error(`[publish] Job ${job?.id} failed:`, err.message);
});
