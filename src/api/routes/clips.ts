import type { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '../../db/client.js';
import { queues } from '../../queue/queues.js';

export async function clipRoutes(app: FastifyInstance) {
  // GET /clips/pending — list all unapproved clips with scores
  app.get('/clips/pending', async (request, reply) => {
    const clips = await prisma.clip.findMany({
      where: { approved: false },
      include: { source: { select: { title: true, initiative: true } } },
      orderBy: [{ totalScore: 'desc' }, { createdAt: 'desc' }],
    });

    return reply.send(clips);
  });

  // GET /clips/:id
  app.get('/clips/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const clip = await prisma.clip.findUnique({
      where: { id },
      include: { posts: true, source: true },
    });

    if (!clip) return reply.status(404).send({ error: 'Clip not found' });
    return reply.send(clip);
  });

  // POST /clips/:id/approve — approve clip and trigger pipeline
  app.post('/clips/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { platforms?: string[]; caption?: string } | undefined;

    const clip = await prisma.clip.findUnique({
      where: { id },
      include: { source: { select: { id: true, filePath: true, url: true } } },
    });
    if (!clip) return reply.status(404).send({ error: 'Clip not found' });

    await prisma.clip.update({ where: { id }, data: { approved: true } });

    const platforms = body?.platforms ?? ['tiktok', 'instagram'];
    const caption = body?.caption;

    if (clip.filePath) {
      // Already reframed — go straight to edit
      const dbJob = await prisma.job.create({
        data: {
          sourceId: clip.source.id,
          type: 'edit',
          status: 'queued',
          input: JSON.stringify({ clipId: id, reframedPath: clip.filePath }),
        },
      });

      await queues.edit.add('edit-clip', {
        dbJobId: dbJob.id,
        clipId: id,
        reframedPath: clip.filePath,
        outputDir: path.dirname(clip.filePath),
        platforms,
        caption,
      });

      return reply.send({ ok: true, message: `Clip ${id} approved — edit job enqueued` });
    }

    // Needs reframe first — validate clip has timestamps
    if (clip.startSec == null || clip.endSec == null) {
      return reply.status(422).send({ error: 'Clip has no timestamps — run clip selection first' });
    }

    const sourcePath = clip.source.filePath ?? clip.source.url;
    if (!sourcePath) {
      return reply.status(422).send({ error: 'Source has no video file or URL' });
    }

    const outputDir = path.resolve(
      'output', 'clips',
      `${new Date().toISOString().slice(0, 10)}-${id}`
    );
    const clipDefsPath = path.join(outputDir, 'clip_definitions.json');

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(clipDefsPath, JSON.stringify([{
      id: clip.id,
      start: clip.startSec,
      end: clip.endSec,
      title: clip.title ?? clip.id,
    }]));

    const dbJob = await prisma.job.create({
      data: {
        sourceId: clip.source.id,
        type: 'reframe',
        status: 'queued',
        input: JSON.stringify({ clipId: id, outputDir }),
      },
    });

    await queues.reframe.add('reframe-clip', {
      dbJobId: dbJob.id,
      clipId: id,
      sourcePath,
      clipDefinitionsPath: clipDefsPath,
      outputDir,
      platforms,
      caption,
    });

    return reply.send({ ok: true, message: `Clip ${id} approved — reframe job enqueued` });
  });

  // POST /clips/:id/reject
  app.post('/clips/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };

    const clip = await prisma.clip.findUnique({ where: { id }, select: { id: true } });
    if (!clip) return reply.status(404).send({ error: 'Clip not found' });

    await prisma.clip.update({ where: { id }, data: { approved: false } });
    return reply.send({ ok: true });
  });
}
