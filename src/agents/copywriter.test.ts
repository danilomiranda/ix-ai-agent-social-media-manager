import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock base.ts (runAgent) ───────────────────────────────────────────────────

const mockRunAgent = vi.fn();
vi.mock('./base.js', () => ({ runAgent: mockRunAgent }));

const { runCopywriterAgent } = await import('./copywriter.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const tiktokCopy = {
  platform: 'tiktok',
  caption: 'We built a $10M business with no funding. Here is what nobody tells you.',
  hashtags: ['#ai', '#business', '#startup'],
  charCount: 78,
};

const youtubeCopy = {
  platform: 'youtube',
  title: 'From Zero to $10M — No Funding, No Excuses',
  caption: 'The real story behind building without investors.',
  hashtags: ['#ai', '#entrepreneurship'],
  charCount: 51,
};

// ─── runCopywriterAgent ───────────────────────────────────────────────────────

describe('runCopywriterAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array without calling API when platforms is empty', async () => {
    const result = await runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: 'Some text',
      platforms: [],
    });
    expect(result).toEqual([]);
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it('calls runAgent once with all platforms in the user message', async () => {
    mockRunAgent.mockResolvedValue([tiktokCopy, youtubeCopy]);
    await runCopywriterAgent({
      clipTitle: 'My Clip',
      transcriptExcerpt: 'We made $10M',
      platforms: ['tiktok', 'youtube'],
    });

    expect(mockRunAgent).toHaveBeenCalledOnce();
    const { userMessage } = mockRunAgent.mock.calls[0][0];
    expect(userMessage).toContain('tiktok');
    expect(userMessage).toContain('youtube');
    expect(userMessage).toContain('My Clip');
  });

  it('returns platform copy array from runAgent', async () => {
    mockRunAgent.mockResolvedValue([tiktokCopy]);
    const result = await runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: 'Some text',
      platforms: ['tiktok'],
    });

    expect(result).toHaveLength(1);
    expect(result[0].platform).toBe('tiktok');
    expect(result[0].caption).toBeTruthy();
  });

  it('strips # prefix from hashtags', async () => {
    mockRunAgent.mockResolvedValue([{
      ...tiktokCopy,
      hashtags: ['#ai', '#startup', 'business'], // mixed
    }]);
    const result = await runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: 'text',
      platforms: ['tiktok'],
    });

    expect(result[0].hashtags).toEqual(['ai', 'startup', 'business']);
  });

  it('does not strip hashtags that have no # prefix', async () => {
    mockRunAgent.mockResolvedValue([{
      ...tiktokCopy,
      hashtags: ['ai', 'business'],
    }]);
    const result = await runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: 'text',
      platforms: ['tiktok'],
    });

    expect(result[0].hashtags).toEqual(['ai', 'business']);
  });

  it('truncates transcriptExcerpt to 400 chars in the prompt', async () => {
    mockRunAgent.mockResolvedValue([tiktokCopy]);
    const longExcerpt = 'word '.repeat(200); // ~1000 chars
    await runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: longExcerpt,
      platforms: ['tiktok'],
    });

    const { userMessage } = mockRunAgent.mock.calls[0][0];
    // Extract what's between the quotes in the excerpt field
    const excerptInPrompt = userMessage.split('"')[1] ?? '';
    expect(excerptInPrompt.length).toBeLessThanOrEqual(400);
  });

  it('includes voice rules in system prompt', async () => {
    mockRunAgent.mockResolvedValue([tiktokCopy]);
    await runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: 'text',
      platforms: ['tiktok'],
    });

    const { system } = mockRunAgent.mock.calls[0][0];
    expect(system).toContain('BANNED WORDS');
    expect(system).toContain('educator');
  });

  it('propagates errors from runAgent', async () => {
    mockRunAgent.mockRejectedValue(new Error('Zod parse error'));
    await expect(runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: 'text',
      platforms: ['tiktok'],
    })).rejects.toThrow('Zod parse error');
  });

  it('returns youtube copy with title field', async () => {
    mockRunAgent.mockResolvedValue([youtubeCopy]);
    const result = await runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: 'text',
      platforms: ['youtube'],
    });

    expect(result[0].title).toBeTruthy();
    expect(typeof result[0].title).toBe('string');
  });

  it('passes maxTokens: 4096 to runAgent', async () => {
    mockRunAgent.mockResolvedValue([tiktokCopy]);
    await runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: 'text',
      platforms: ['tiktok'],
    });
    const callOpts = mockRunAgent.mock.calls[0][0];
    expect(callOpts.maxTokens).toBe(4096);
  });

  it('accepts initiative param without breaking (it is optional and not used in prompt)', async () => {
    mockRunAgent.mockResolvedValue([tiktokCopy]);
    await expect(runCopywriterAgent({
      clipTitle: 'Test',
      transcriptExcerpt: 'text',
      platforms: ['tiktok'],
      initiative: 'consulting',
    })).resolves.toHaveLength(1);
  });
});
