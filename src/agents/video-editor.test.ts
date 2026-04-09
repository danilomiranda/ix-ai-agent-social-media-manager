import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TranscriptWord } from './prescreener.js';

// ── Mock base.ts ──────────────────────────────────────────────────────────────

const mockRunAgent = vi.fn();
vi.mock('./base.js', () => ({ runAgent: mockRunAgent }));

const { runVideoEditorAgent } = await import('./video-editor.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeWords(count: number): TranscriptWord[] {
  return Array.from({ length: count }, (_, i) => ({
    word: `word${i}`,
    start: i * 0.4,
    end: (i + 1) * 0.4,
  }));
}

const validOutput = {
  tsxContent: 'import React from "react"; export default function MyComp() { return <div/>; }',
  wordsContent: 'export const TOTAL_DURATION_FRAMES = 1800;',
  compositionName: 'ClipAbc12345',
  totalDurationFrames: 1800,
};

const baseOpts = {
  compositionId: 'ClipAbc12345',
  clipTitle: 'How I Built $10M in 6 Months',
  durationSec: 60,
  transcriptExcerpt: 'We started with nothing. Three years later we crossed $10M ARR.',
  wordsJson: makeWords(150),
  reframedVideoPath: 'output/clips/2026-04-07-test/reframed-9x16.mp4',
};

// ─── runVideoEditorAgent ──────────────────────────────────────────────────────

describe('runVideoEditorAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAgent.mockResolvedValue(validOutput);
  });

  it('returns tsxContent, wordsContent, compositionName, totalDurationFrames', async () => {
    const result = await runVideoEditorAgent(baseOpts);
    expect(result.tsxContent).toBeTruthy();
    expect(result.wordsContent).toBeTruthy();
    expect(result.compositionName).toBe('ClipAbc12345');
    expect(result.totalDurationFrames).toBe(1800);
  });

  it('includes compositionId in the user message', async () => {
    await runVideoEditorAgent(baseOpts);
    const { userMessage } = mockRunAgent.mock.calls[0][0];
    expect(userMessage).toContain('ClipAbc12345');
  });

  it('includes reframedVideoPath in the user message', async () => {
    await runVideoEditorAgent(baseOpts);
    const { userMessage } = mockRunAgent.mock.calls[0][0];
    expect(userMessage).toContain('output/clips/2026-04-07-test/reframed-9x16.mp4');
  });

  it('includes clip title in the user message', async () => {
    await runVideoEditorAgent(baseOpts);
    const { userMessage } = mockRunAgent.mock.calls[0][0];
    expect(userMessage).toContain('How I Built $10M in 6 Months');
  });

  it('includes transcript excerpt in the user message', async () => {
    await runVideoEditorAgent(baseOpts);
    const { userMessage } = mockRunAgent.mock.calls[0][0];
    expect(userMessage).toContain('We started with nothing');
  });

  it('passes maxTokens: 8192 to runAgent', async () => {
    await runVideoEditorAgent(baseOpts);
    const callOpts = mockRunAgent.mock.calls[0][0];
    expect(callOpts.maxTokens).toBe(8192);
  });

  it('includes Remotion rules in system prompt (FPS, portrait resolution)', async () => {
    await runVideoEditorAgent(baseOpts);
    const { system } = mockRunAgent.mock.calls[0][0];
    expect(system).toContain('30');
    expect(system).toContain('1080x1920');
  });

  it('includes pop-out timing instruction in system prompt', async () => {
    await runVideoEditorAgent(baseOpts);
    const { system } = mockRunAgent.mock.calls[0][0];
    expect(system).toContain('staticFile()');
  });

  it('limits wordsJson to first 200 words in the prompt', async () => {
    const manyWords = makeWords(400);
    await runVideoEditorAgent({ ...baseOpts, wordsJson: manyWords });
    const { userMessage } = mockRunAgent.mock.calls[0][0];
    // word400 would appear if the full array was sent — it must not be present
    expect(userMessage).not.toContain('word399');
    // word0 through word199 should be present
    expect(userMessage).toContain('word0');
    expect(userMessage).toContain('word199');
  });

  it('handles empty wordsJson without throwing', async () => {
    await expect(
      runVideoEditorAgent({ ...baseOpts, wordsJson: [] })
    ).resolves.toMatchObject({ compositionName: 'ClipAbc12345' });
  });

  it('propagates errors from runAgent', async () => {
    mockRunAgent.mockRejectedValue(new Error('Zod validation failed'));
    await expect(runVideoEditorAgent(baseOpts)).rejects.toThrow('Zod validation failed');
  });

  it('includes duration in frames in the user message', async () => {
    await runVideoEditorAgent({ ...baseOpts, durationSec: 75 });
    const { userMessage } = mockRunAgent.mock.calls[0][0];
    // 75s * 30fps = 2250 frames
    expect(userMessage).toContain('2250');
  });
});
