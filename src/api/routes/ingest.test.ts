import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import path from 'path';

// Mock Prisma and BullMQ before importing the route
vi.mock('../../db/client.js', () => ({
  prisma: {
    source: {
      create: vi.fn().mockResolvedValue({ id: 'source-123' }),
    },
    job: {
      create: vi.fn().mockResolvedValue({ id: 'job-456' }),
    },
  },
}));

vi.mock('../../queue/queues.js', () => ({
  queues: {
    transcribe: { add: vi.fn().mockResolvedValue(undefined) },
  },
}));

// Import after mocks are registered
const { ingestRoutes } = await import('./ingest.js');
const { prisma } = await import('../../db/client.js');
const { queues } = await import('../../queue/queues.js');

function buildApp() {
  const app = Fastify();
  app.register(ingestRoutes);
  return app;
}

describe('POST /ingest', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  // ── Validation failures ────────────────────────────────────────────────────

  it('returns 400 when neither filePath nor url is provided', async () => {
    const res = await app.inject({ method: 'POST', url: '/ingest', body: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/filePath or url is required/);
  });

  it('returns 400 for relative filePath', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ingest',
      body: { filePath: 'relative/path/video.mp4' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/absolute/);
  });

  it('returns 400 for path traversal in filePath', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ingest',
      body: { filePath: '/Users/danilomiranda/dev/dan-social-media-manager/../../../etc/passwd' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/project directory/);
  });

  it('returns 400 for http:// url (not https)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ingest',
      body: { url: 'http://youtube.com/watch?v=abc' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/https/);
  });

  it('returns 400 for ftp:// url', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ingest',
      body: { url: 'ftp://evil.com/file.mp4' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/https/);
  });

  // ── Happy paths ───────────────────────────────────────────────────────────

  it('returns 201 with sourceId and jobId for valid https:// url', async () => {
    const res = await app.inject({
      method: 'POST', url: '/ingest',
      body: { url: 'https://youtube.com/watch?v=abc123', title: 'My Video' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ sourceId: 'source-123', jobId: 'job-456' });
  });

  it('returns 201 with valid absolute filePath inside project root', async () => {
    const validPath = path.resolve('input/test-video.mp4');
    const res = await app.inject({
      method: 'POST', url: '/ingest',
      body: { filePath: validPath },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ sourceId: 'source-123', jobId: 'job-456' });
  });

  it('creates a Source record with correct type for URL', async () => {
    await app.inject({
      method: 'POST', url: '/ingest',
      body: { url: 'https://youtube.com/watch?v=test' },
    });
    expect(prisma.source.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'youtube_video' }) })
    );
  });

  it('creates a Source record with correct type for filePath', async () => {
    const validPath = path.resolve('input/video.mp4');
    await app.inject({ method: 'POST', url: '/ingest', body: { filePath: validPath } });
    expect(prisma.source.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'local_file' }) })
    );
  });

  it('defaults initiative to social_engine', async () => {
    await app.inject({
      method: 'POST', url: '/ingest',
      body: { url: 'https://youtube.com/watch?v=test' },
    });
    expect(prisma.source.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ initiative: 'social_engine' }) })
    );
  });

  it('uses provided initiative value', async () => {
    await app.inject({
      method: 'POST', url: '/ingest',
      body: { url: 'https://youtube.com/watch?v=test', initiative: 'consulting' },
    });
    expect(prisma.source.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ initiative: 'consulting' }) })
    );
  });

  it('enqueues a transcribe job to BullMQ', async () => {
    await app.inject({
      method: 'POST', url: '/ingest',
      body: { url: 'https://youtube.com/watch?v=test' },
    });
    expect(queues.transcribe.add).toHaveBeenCalledWith(
      'transcribe',
      expect.objectContaining({ sourceId: 'source-123', jobId: 'job-456' })
    );
  });

  it('returns 400 for absolute filePath outside project root', async () => {
    const outsidePath = '/Users/other-user/secret/video.mp4';
    const res = await app.inject({
      method: 'POST', url: '/ingest',
      body: { filePath: outsidePath },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/project directory/);
  });

  it('outputDir in enqueued job uses YYYY-MM-DD slug format', async () => {
    await app.inject({
      method: 'POST', url: '/ingest',
      body: { url: 'https://youtube.com/watch?v=test', title: 'My Great Video' },
    });
    const callArgs = (queues.transcribe.add as any).mock.calls[0][1];
    expect(callArgs.outputDir).toMatch(/output\/clips\/\d{4}-\d{2}-\d{2}-/);
  });
});
