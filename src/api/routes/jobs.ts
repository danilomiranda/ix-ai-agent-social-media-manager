import type { FastifyInstance } from 'fastify';
import { prisma } from '../../db/client.js';

export async function jobRoutes(app: FastifyInstance) {
  // GET /jobs/:id
  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    return reply.send(job);
  });

  // GET /jobs?sourceId=xxx
  app.get('/jobs', async (request, reply) => {
    const { sourceId } = request.query as { sourceId?: string };

    const jobs = await prisma.job.findMany({
      where: sourceId ? { sourceId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return reply.send(jobs);
  });
}
