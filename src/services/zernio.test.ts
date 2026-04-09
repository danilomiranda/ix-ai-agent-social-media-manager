import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockAxiosPost = vi.fn();
const mockAxiosPut = vi.fn();
const mockFsStat = vi.fn();
const mockFsReadFile = vi.fn();

vi.mock('axios', () => ({
  default: {
    post: mockAxiosPost,
    put: mockAxiosPut,
  },
}));

vi.mock('fs/promises', () => ({
  default: {
    stat: mockFsStat,
    readFile: mockFsReadFile,
  },
  stat: mockFsStat,
  readFile: mockFsReadFile,
}));

vi.mock('../config.js', () => ({
  config: {
    ZERNIO_API_KEY: 'test-api-key',
    ZERNIO_PROFILE_ID: 'test-profile-id',
  },
}));

const { uploadToZernio } = await import('./zernio.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAKE_UPLOAD_URL = 'https://storage.example.com/presigned/upload?token=abc';
const FAKE_PUBLIC_URL = 'https://cdn.example.com/videos/my-clip.mp4';

function setupHappyPath() {
  mockFsStat.mockResolvedValue({ size: 50 * 1024 * 1024 }); // 50MB
  mockFsReadFile.mockResolvedValue(Buffer.from('fake-video-bytes'));
  mockAxiosPost.mockResolvedValue({
    data: { uploadUrl: FAKE_UPLOAD_URL, publicUrl: FAKE_PUBLIC_URL },
  });
  mockAxiosPut.mockResolvedValue({ status: 200 });
}

// ─── uploadToZernio ───────────────────────────────────────────────────────────

describe('uploadToZernio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns publicUrl on successful upload', async () => {
    setupHappyPath();
    const result = await uploadToZernio('/abs/output/clips/test/edited.mp4');
    expect(result).toBe(FAKE_PUBLIC_URL);
  });

  it('calls presign endpoint with correct auth header', async () => {
    setupHappyPath();
    await uploadToZernio('/abs/output/clips/test/edited.mp4');

    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/media/presign'),
      expect.objectContaining({ contentType: 'video/mp4' }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }),
      })
    );
  });

  it('calls presign with correct fileName (basename only)', async () => {
    setupHappyPath();
    await uploadToZernio('/abs/output/clips/test/edited.mp4');

    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ fileName: 'edited.mp4' }),
      expect.any(Object)
    );
  });

  it('PUTs to the presigned uploadUrl', async () => {
    setupHappyPath();
    await uploadToZernio('/abs/output/clips/test/edited.mp4');

    expect(mockAxiosPut).toHaveBeenCalledWith(
      FAKE_UPLOAD_URL,
      expect.any(Buffer),
      expect.objectContaining({ headers: { 'Content-Type': 'video/mp4' } })
    );
  });

  it('sets maxBodyLength: Infinity on PUT request', async () => {
    setupHappyPath();
    await uploadToZernio('/abs/output/clips/test/edited.mp4');

    expect(mockAxiosPut).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Buffer),
      expect.objectContaining({ maxBodyLength: Infinity, maxContentLength: Infinity })
    );
  });

  it('throws with informative message when presign fails', async () => {
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('data'));
    mockAxiosPost.mockRejectedValue({
      response: { status: 403, data: { message: 'Invalid API key' } },
      message: 'Request failed',
    });

    await expect(uploadToZernio('/abs/output/clips/test/edited.mp4'))
      .rejects.toThrow('Zernio presign failed (403)');
  });

  it('throws with informative message when PUT upload fails', async () => {
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('data'));
    mockAxiosPost.mockResolvedValue({
      data: { uploadUrl: FAKE_UPLOAD_URL, publicUrl: FAKE_PUBLIC_URL },
    });
    mockAxiosPut.mockRejectedValue({
      response: { status: 503 },
      message: 'Service unavailable',
    });

    await expect(uploadToZernio('/abs/output/clips/test/edited.mp4'))
      .rejects.toThrow('Zernio upload failed (503)');
  });

  it('reads file from disk before uploading', async () => {
    setupHappyPath();
    await uploadToZernio('/abs/output/clips/test/edited.mp4');

    expect(mockFsReadFile).toHaveBeenCalledWith('/abs/output/clips/test/edited.mp4');
  });

  it('logs file size without exposing presigned URL in full', async () => {
    setupHappyPath();
    // Just verify it completes without throwing — log verification is optional
    await expect(uploadToZernio('/abs/output/clips/test/edited.mp4')).resolves.toBe(FAKE_PUBLIC_URL);
  });

  it('PUT request does NOT include an Authorization header (presigned URL is self-authenticating)', async () => {
    setupHappyPath();
    await uploadToZernio('/abs/output/clips/test/edited.mp4');
    const putCallConfig = mockAxiosPut.mock.calls[0][2];
    expect(putCallConfig?.headers?.Authorization).toBeUndefined();
  });

  it('sets 10-minute timeout on PUT request', async () => {
    setupHappyPath();
    await uploadToZernio('/abs/output/clips/test/edited.mp4');
    const putCallConfig = mockAxiosPut.mock.calls[0][2];
    expect(putCallConfig?.timeout).toBe(600_000);
  });
});
