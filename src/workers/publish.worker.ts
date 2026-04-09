import { Worker } from 'bullmq';
import fs from 'fs/promises';
import axios from 'axios';
import { connection } from '../queue/queues.js';
import { prisma } from '../db/client.js';
import { config } from '../config.js';
import { assertSafeOutputDir } from './utils.js';
import { uploadToZernio } from '../services/zernio.js';
import { runCopywriterAgent } from '../agents/copywriter.js';
import type { PlatformCopy } from '../agents/copywriter.js';

const LATE_BASE = 'https://getlate.dev/api/v1';

export const publishWorker = new Worker(
  'publish',
  async (job) => {
    const { clipId, editedPath, platforms, caption, title, hashtags } = job.data;

    console.log(`[publish] Starting publish for clip ${clipId} → ${platforms?.join(', ')}`);

    // Validate editedPath exists and is inside output/
    if (!editedPath) throw new Error('editedPath is required for publishing');
    assertSafeOutputDir(editedPath.replace('/edited.mp4', ''));
    await fs.access(editedPath).catch(() => {
      throw new Error(`editedPath not found on disk: ${editedPath}`);
    });

    // Look up clip for context
    const clip = await prisma.clip.findUnique({
      where: { id: clipId },
      select: { title: true, transcriptExcerpt: true },
    });
    if (!clip) throw new Error(`Clip ${clipId} not found`);

    // Upload to Zernio
    const publicUrl = await uploadToZernio(editedPath);

    // Generate per-platform copy or use provided caption
    let platformCopy: PlatformCopy[];
    if (!caption) {
      platformCopy = await runCopywriterAgent({
        clipTitle: clip.title ?? 'Untitled',
        transcriptExcerpt: clip.transcriptExcerpt ?? '',
        platforms: platforms ?? ['tiktok', 'instagram'],
      });
    } else {
      platformCopy = (platforms ?? ['tiktok', 'instagram']).map(p => ({
        platform: p,
        caption,
        title,
        hashtags: hashtags ?? [],
        charCount: caption.length,
      }));
    }

    // Publish per platform
    let successCount = 0;
    for (const copy of platformCopy) {
      // Check for existing draft post to upsert
      const existing = await prisma.post.findFirst({
        where: { clipId, platform: copy.platform },
        select: { id: true },
      });

      try {
        const lateRes = await axios.post(
          `${LATE_BASE}/posts`,
          {
            profileId: config.ZERNIO_PROFILE_ID,
            platforms: [copy.platform],
            mediaUrl: publicUrl,
            caption: copy.caption,
            title: copy.title,
            hashtags: copy.hashtags,
          },
          { headers: { Authorization: `Bearer ${config.ZERNIO_API_KEY}` } }
        );

        const latePostId = lateRes.data?.id ?? lateRes.data?.postId;

        if (existing) {
          await prisma.post.update({
            where: { id: existing.id },
            data: {
              latePostId,
              title: copy.title,
              caption: copy.caption,
              hashtags: JSON.stringify(copy.hashtags),
              status: 'published',
              publishedAt: new Date(),
            },
          });
        } else {
          await prisma.post.create({
            data: {
              clipId,
              platform: copy.platform,
              latePostId,
              title: copy.title,
              caption: copy.caption,
              hashtags: JSON.stringify(copy.hashtags),
              status: 'published',
              publishedAt: new Date(),
            },
          });
        }

        successCount++;
        console.log(`[publish] Posted to ${copy.platform}`);
      } catch (err: any) {
        console.error(`[publish] Failed to post to ${copy.platform}:`, err?.response?.data ?? err.message);
        if (existing) {
          await prisma.post.update({
            where: { id: existing.id },
            data: { status: 'failed' },
          });
        } else {
          await prisma.post.create({
            data: {
              clipId,
              platform: copy.platform,
              caption: copy.caption,
              hashtags: copy.hashtags ? JSON.stringify(copy.hashtags) : null,
              status: 'failed',
            },
          });
        }
      }
    }

    console.log(`[publish] Done — ${successCount}/${platformCopy.length} platforms published for clip ${clipId}`);
  },
  {
    connection,
    concurrency: 3,
  }
);

publishWorker.on('failed', (job, err) => {
  console.error(`[publish] Job ${job?.id} failed:`, err.message);
});
