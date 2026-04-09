import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import path from 'path';

// ── Shared mock state ────────────────────────────────────────────────────────

const mockClipFindUnique = vi.fn();
const mockClipUpdate = vi.fn();
const mockJobCreate = vi.fn().mockResolvedValue({ id: 'job-789' });
const mockClipFindMany = vi.fn().mockResolvedValue([]);

vi.mock('../../db/client.js', () => ({
  prisma: {
    clip: {
      findUnique: mockClipFindUnique,
      findMany: mockClipFindMany,
      update: mockClipUpdate,
    },
    job: {
      create: mockJobCreate,
    },
  },
}));

vi.mock('../../queue/queues.js', () => ({
  queues: {
    edit: { add: vi.fn().mockResolvedValue(undefined) },
    reframe: { add: vi.fn().mockResolvedValue(undefined) },
  },
}));

// Mock fs to avoid actual disk writes
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

const { clipRoutes } = await import('./clips.js');
const { queues } = await import('../../queue/queues.js');

function buildApp() {
  const app = Fastify();
  app.register(clipRoutes);
  return app;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const baseClip = {
  id: 'clip-abc',
  sourceId: 'source-xyz',
  approved: false,
  filePath: null,
  startSec: 10,
  endSec: 70,
  title: 'Test Clip',
  source: { id: 'source-xyz', filePath: '/abs/path/video.mp4', url: null },
};

// ─── GET /clips/pending ──────────────────────────────────────────────────────

describe('GET /clips/pending', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockClipFindMany.mockResolvedValue([]);
  });

  it('returns 200 with empty array when no pending clips', async () => {
    const res = await app.inject({ method: 'GET', url: '/clips/pending' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns list of unapproved clips', async () => {
    mockClipFindMany.mockResolvedValue([{ ...baseClip, totalScore: 350 }]);
    const res = await app.inject({ method: 'GET', url: '/clips/pending' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

// ─── GET /clips/:id ──────────────────────────────────────────────────────────

describe('GET /clips/:id', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns 404 when clip not found', async () => {
    mockClipFindUnique.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/clips/nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/Clip not found/);
  });

  it('returns clip data when found', async () => {
    mockClipFindUnique.mockResolvedValue({ ...baseClip, posts: [], source: baseClip.source });
    const res = await app.inject({ method: 'GET', url: '/clips/clip-abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('clip-abc');
  });
});

// ─── POST /clips/:id/approve ─────────────────────────────────────────────────

describe('POST /clips/:id/approve', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockJobCreate.mockResolvedValue({ id: 'job-789' });
    mockClipUpdate.mockResolvedValue({});
  });

  it('returns 404 when clip not found', async () => {
    mockClipFindUnique.mockResolvedValue(null);
    const res = await app.inject({ method: 'POST', url: '/clips/unknown/approve', body: {} });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/Clip not found/);
  });

  it('returns 422 when clip has no timestamps', async () => {
    mockClipFindUnique.mockResolvedValue({ ...baseClip, startSec: null, endSec: null });
    const res = await app.inject({ method: 'POST', url: '/clips/clip-abc/approve', body: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/no timestamps/);
  });

  it('returns 422 when source has no filePath or url', async () => {
    mockClipFindUnique.mockResolvedValue({
      ...baseClip,
      source: { id: 'source-xyz', filePath: null, url: null },
    });
    const res = await app.inject({ method: 'POST', url: '/clips/clip-abc/approve', body: {} });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/no video file/);
  });

  it('enqueues reframe job when clip has no filePath', async () => {
    mockClipFindUnique.mockResolvedValue(baseClip); // filePath: null
    const res = await app.inject({ method: 'POST', url: '/clips/clip-abc/approve', body: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatch(/reframe/);
    expect(queues.reframe.add).toHaveBeenCalledWith(
      'reframe-clip',
      expect.objectContaining({ clipId: 'clip-abc' })
    );
    expect(queues.edit.add).not.toHaveBeenCalled();
  });

  it('enqueues edit job directly when clip already has filePath', async () => {
    mockClipFindUnique.mockResolvedValue({
      ...baseClip,
      filePath: path.resolve('output/clips/2026-04-07-test/reframed-9x16.mp4'),
    });
    const res = await app.inject({ method: 'POST', url: '/clips/clip-abc/approve', body: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json().message).toMatch(/edit/);
    expect(queues.edit.add).toHaveBeenCalledWith(
      'edit-clip',
      expect.objectContaining({ clipId: 'clip-abc' })
    );
    expect(queues.reframe.add).not.toHaveBeenCalled();
  });

  it('sets clip.approved = true on approve', async () => {
    mockClipFindUnique.mockResolvedValue(baseClip);
    await app.inject({ method: 'POST', url: '/clips/clip-abc/approve', body: {} });
    expect(mockClipUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ approved: true }) })
    );
  });

  it('passes platforms from request body to enqueued job', async () => {
    mockClipFindUnique.mockResolvedValue(baseClip);
    await app.inject({
      method: 'POST', url: '/clips/clip-abc/approve',
      body: { platforms: ['youtube', 'linkedin'] },
    });
    expect(queues.reframe.add).toHaveBeenCalledWith(
      'reframe-clip',
      expect.objectContaining({ platforms: ['youtube', 'linkedin'] })
    );
  });

  it('creates a Job record in the DB before enqueuing', async () => {
    mockClipFindUnique.mockResolvedValue(baseClip);
    await app.inject({ method: 'POST', url: '/clips/clip-abc/approve', body: {} });
    expect(mockJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: 'reframe', status: 'queued' }),
      })
    );
  });

  it('defaults platforms to tiktok and instagram when body is empty', async () => {
    mockClipFindUnique.mockResolvedValue(baseClip);
    await app.inject({ method: 'POST', url: '/clips/clip-abc/approve', body: {} });
    expect(queues.reframe.add).toHaveBeenCalledWith(
      'reframe-clip',
      expect.objectContaining({ platforms: ['tiktok', 'instagram'] })
    );
  });

  it('passes dbJobId from created Job record to the queue', async () => {
    mockJobCreate.mockResolvedValue({ id: 'job-from-db' });
    mockClipFindUnique.mockResolvedValue(baseClip);
    await app.inject({ method: 'POST', url: '/clips/clip-abc/approve', body: {} });
    expect(queues.reframe.add).toHaveBeenCalledWith(
      'reframe-clip',
      expect.objectContaining({ dbJobId: 'job-from-db' })
    );
  });
});

// ─── POST /clips/:id/reject ──────────────────────────────────────────────────

describe('POST /clips/:id/reject', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    mockClipUpdate.mockResolvedValue({});
  });

  it('returns 404 when clip not found', async () => {
    mockClipFindUnique.mockResolvedValue(null);
    const res = await app.inject({ method: 'POST', url: '/clips/unknown/reject', body: {} });
    expect(res.statusCode).toBe(404);
  });

  it('sets clip.approved = false', async () => {
    mockClipFindUnique.mockResolvedValue({ id: 'clip-abc' });
    const res = await app.inject({ method: 'POST', url: '/clips/clip-abc/reject', body: {} });
    expect(res.statusCode).toBe(200);
    expect(mockClipUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { approved: false } })
    );
  });
});
