import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrescreenedSegment } from './prescreener.js';

// ── Mock base.ts (runAgent) ───────────────────────────────────────────────────

const mockRunAgent = vi.fn();
vi.mock('./base.js', () => ({ runAgent: mockRunAgent }));

const { runViralDetectorAgent } = await import('./viral-detector.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSegment(i: number): PrescreenedSegment {
  return {
    start: i * 60,
    end: i * 60 + 60,
    text: `This is segment ${i} about building a $10M business from zero`,
    words: [{ word: `word${i}`, start: i * 60, end: i * 60 + 1 }],
    densityScore: 20,
    hookScore: 15,
    sentimentScore: 5,
    prescreenTotal: 40,
  };
}

const validScoredClip = {
  segmentIndex: 0,
  title: 'From Zero to $10M',
  category: 'data_driven',
  hookStrength: 85,
  valueDelivery: 80,
  clarity: 75,
  shareability: 70,
  completeness: 65,
  totalScore: 375,
  reason: 'Strong hook with concrete numbers',
};

// ─── runViralDetectorAgent ────────────────────────────────────────────────────

describe('runViralDetectorAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array without calling API when segments is empty', async () => {
    const result = await runViralDetectorAgent([]);
    expect(result).toEqual([]);
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it('calls runAgent with segments in the user message', async () => {
    mockRunAgent.mockResolvedValue([validScoredClip]);
    const segs = [makeSegment(0)];
    await runViralDetectorAgent(segs);

    expect(mockRunAgent).toHaveBeenCalledOnce();
    const { userMessage, system } = mockRunAgent.mock.calls[0][0];
    expect(userMessage).toContain('segment 0');
    expect(system).toContain('hookStrength');
  });

  it('returns scored clips from runAgent response', async () => {
    mockRunAgent.mockResolvedValue([validScoredClip]);
    const result = await runViralDetectorAgent([makeSegment(0)]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('From Zero to $10M');
    expect(result[0].totalScore).toBe(375);
  });

  it('returns empty array when Claude finds no viral clips', async () => {
    mockRunAgent.mockResolvedValue([]);
    const result = await runViralDetectorAgent([makeSegment(0), makeSegment(1)]);
    expect(result).toEqual([]);
  });

  it('passes all segments to runAgent', async () => {
    mockRunAgent.mockResolvedValue([]);
    const segs = Array.from({ length: 20 }, (_, i) => makeSegment(i));
    await runViralDetectorAgent(segs);

    const { userMessage } = mockRunAgent.mock.calls[0][0];
    expect(userMessage).toContain('20 transcript segments');
  });

  it('propagates errors from runAgent (Zod validation, API errors)', async () => {
    mockRunAgent.mockRejectedValue(new Error('API rate limit'));
    await expect(runViralDetectorAgent([makeSegment(0)])).rejects.toThrow('API rate limit');
  });

  it('truncates segment text to 500 chars in the prompt', async () => {
    mockRunAgent.mockResolvedValue([]);
    const longText = 'a '.repeat(500); // 1000 chars
    const seg = { ...makeSegment(0), text: longText };
    await runViralDetectorAgent([seg]);

    const { userMessage } = mockRunAgent.mock.calls[0][0];
    // The text in the prompt should be capped at 500 chars
    const promptSegmentLength = userMessage.split('"')[1]?.length ?? 0;
    expect(promptSegmentLength).toBeLessThanOrEqual(500);
  });

  it('uses correct model via runAgent options', async () => {
    mockRunAgent.mockResolvedValue([validScoredClip]);
    await runViralDetectorAgent([makeSegment(0)]);

    const callOpts = mockRunAgent.mock.calls[0][0];
    // model defaults to claude-sonnet-4-6 in base.ts — no explicit model override expected
    expect(callOpts).toHaveProperty('schema');
    expect(callOpts).toHaveProperty('maxTokens', 4096);
  });
});
