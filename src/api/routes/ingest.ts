import type { FastifyInstance } from 'fastify';
import path from 'path';
import { prisma } from '../../db/client.js';
import { queues } from '../../queue/queues.js';

export async function ingestRoutes(app: FastifyInstance) {
  // POST /ingest — trigger pipeline for a video file path or URL
  app.post('/ingest', async (request, reply) => {
    const body = request.body as {
      filePath?: string;
      url?: string;
      title?: string;
      initiative?: string;
    };

    if (!body.filePath && !body.url) {
      return reply.status(400).send({ error: 'filePath or url is required' });
    }

    const fileName = body.title ?? path.basename(body.filePath ?? body.url ?? 'unknown');
    const outputDir = path.resolve(
      'output', 'clips',
      `${new Date().toISOString().slice(0, 10)}-${fileName.replace(/\s+/g, '-').toLowerCase()}`
    );

    const source = await prisma.source.create({
      data: {
        type: body.url ? 'youtube_video' : 'local_file',
        filePath: body.filePath,
        url: body.url,
        title: fileName,
        initiative: body.initiative ?? 'social_engine',
        status: 'pending',
      },
    });

    const job = await prisma.job.create({
      data: {
        sourceId: source.id,
        type: 'transcribe',
        status: 'queued',
        input: JSON.stringify({ filePath: body.filePath, url: body.url, outputDir }),
      },
    });

    await queues.transcribe.add('transcribe', {
      jobId: job.id,
      sourceId: source.id,
      sourcePath: body.filePath ?? body.url,
      outputDir,
    });

    return reply.status(201).send({ sourceId: source.id, jobId: job.id });
  });
}
