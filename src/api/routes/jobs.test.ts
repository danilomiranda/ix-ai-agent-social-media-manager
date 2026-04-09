import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockJobFindUnique = vi.fn();
const mockJobFindMany = vi.fn();

vi.mock('../../db/client.js', () => ({
  prisma: {
    job: {
      findUnique: mockJobFindUnique,
      findMany: mockJobFindMany,
    },
  },
}));

const { jobRoutes } = await import('./jobs.js');

function buildApp() {
  const app = Fastify();
  app.register(jobRoutes);
  return app;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseJob = {
  id: 'job-abc',
  sourceId: 'source-xyz',
  type: 'transcribe',
  status: 'done',
  input: JSON.stringify({ filePath: '/abs/path/video.mp4' }),
  output: JSON.stringify({ outputDir: 'output/clips/2026-04-07-test' }),
  error: null,
  startedAt: new Date('2026-04-07T10:00:00Z'),
  completedAt: new Date('2026-04-07T10:05:00Z'),
  createdAt: new Date('2026-04-07T09:59:00Z'),
};

// ─── GET /jobs/:id ────────────────────────────────────────────────────────────

describe('GET /jobs/:id', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns 404 when job is not found', async () => {
    mockJobFindUnique.mockResolvedValue(null);
    const res = await app.inject({ method: 'GET', url: '/jobs/nonexistent' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toMatch(/Job not found/);
  });

  it('returns 200 with job data when found', async () => {
    mockJobFindUnique.mockResolvedValue(baseJob);
    const res = await app.inject({ method: 'GET', url: '/jobs/job-abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('job-abc');
  });

  it('returns all job fields', async () => {
    mockJobFindUnique.mockResolvedValue(baseJob);
    const res = await app.inject({ method: 'GET', url: '/jobs/job-abc' });
    const body = res.json();
    expect(body).toMatchObject({
      id: 'job-abc',
      sourceId: 'source-xyz',
      type: 'transcribe',
      status: 'done',
    });
  });

  it('queries by the correct job id', async () => {
    mockJobFindUnique.mockResolvedValue(baseJob);
    await app.inject({ method: 'GET', url: '/jobs/job-abc' });
    expect(mockJobFindUnique).toHaveBeenCalledWith({ where: { id: 'job-abc' } });
  });

  it('returns failed job with error field', async () => {
    mockJobFindUnique.mockResolvedValue({ ...baseJob, status: 'failed', error: 'Process exited with code 1' });
    const res = await app.inject({ method: 'GET', url: '/jobs/job-abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json().error).toBe('Process exited with code 1');
    expect(res.json().status).toBe('failed');
  });
});

// ─── GET /jobs ────────────────────────────────────────────────────────────────

describe('GET /jobs', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
  });

  it('returns 200 with empty array when no jobs exist', async () => {
    mockJobFindMany.mockResolvedValue([]);
    const res = await app.inject({ method: 'GET', url: '/jobs' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('filters by sourceId when provided', async () => {
    mockJobFindMany.mockResolvedValue([baseJob]);
    const res = await app.inject({ method: 'GET', url: '/jobs?sourceId=source-xyz' });
    expect(res.statusCode).toBe(200);
    expect(mockJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceId: 'source-xyz' } })
    );
  });

  it('returns all jobs when no sourceId provided', async () => {
    mockJobFindMany.mockResolvedValue([baseJob]);
    await app.inject({ method: 'GET', url: '/jobs' });
    expect(mockJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });

  it('limits results to 50', async () => {
    mockJobFindMany.mockResolvedValue([]);
    await app.inject({ method: 'GET', url: '/jobs?sourceId=source-xyz' });
    expect(mockJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it('orders by createdAt descending (newest first)', async () => {
    mockJobFindMany.mockResolvedValue([]);
    await app.inject({ method: 'GET', url: '/jobs' });
    expect(mockJobFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } })
    );
  });

  it('returns multiple jobs for a source', async () => {
    const jobs = [
      { ...baseJob, id: 'job-1', type: 'transcribe' },
      { ...baseJob, id: 'job-2', type: 'select' },
      { ...baseJob, id: 'job-3', type: 'reframe' },
    ];
    mockJobFindMany.mockResolvedValue(jobs);
    const res = await app.inject({ method: 'GET', url: '/jobs?sourceId=source-xyz' });
    expect(res.json()).toHaveLength(3);
  });
});
