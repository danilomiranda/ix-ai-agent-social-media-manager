import type { FastifyInstance } from 'fastify';
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

  // POST /clips/:id/approve — approve clip and trigger edit + publish pipeline
  app.post('/clips/:id/approve', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { platforms?: string[]; caption?: string } | undefined;

    const clip = await prisma.clip.findUnique({ where: { id } });
    if (!clip) return reply.status(404).send({ error: 'Clip not found' });

    await prisma.clip.update({ where: { id }, data: { approved: true } });

    // Trigger reframe (if not already done) or edit directly
    if (clip.filePath) {
      await queues.edit.add('edit-clip', {
        clipId: id,
        reframedPath: clip.filePath,
        outputDir: clip.filePath.replace('/reframed-9x16.mp4', ''),
        platforms: body?.platforms ?? ['tiktok', 'instagram'],
        caption: body?.caption,
      });
    } else {
      return reply.status(422).send({ error: 'Clip has no reframed video yet. Run reframe first.' });
    }

    return reply.send({ ok: true, message: `Clip ${id} approved — edit job enqueued` });
  });

  // POST /clips/:id/reject
  app.post('/clips/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };

    await prisma.clip.update({ where: { id }, data: { approved: false } });
    return reply.send({ ok: true });
  });
}
