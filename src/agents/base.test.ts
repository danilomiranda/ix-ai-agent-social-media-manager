import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

// ── Mock Anthropic SDK and config before importing base ────────────────────────

const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

vi.mock('../config.js', () => ({
  config: { ANTHROPIC_API_KEY: 'test-key' },
}));

const { runAgent } = await import('./base.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

const SimpleSchema = z.object({ value: z.string() });
type Simple = z.infer<typeof SimpleSchema>;

function makeTextResponse(text: string) {
  return { content: [{ type: 'text', text }] };
}

// ─── runAgent ─────────────────────────────────────────────────────────────────

describe('runAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed object when response is valid JSON', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('{"value":"hello"}'));
    const result = await runAgent<Simple>({
      system: 'You are a helper.',
      userMessage: 'Test',
      schema: SimpleSchema,
    });
    expect(result).toEqual({ value: 'hello' });
  });

  it('strips leading ```json code block markers', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeTextResponse('```json\n{"value":"stripped"}\n```')
    );
    const result = await runAgent<Simple>({
      system: 'sys',
      userMessage: 'msg',
      schema: SimpleSchema,
    });
    expect(result.value).toBe('stripped');
  });

  it('strips leading ``` (no language) code block markers', async () => {
    mockMessagesCreate.mockResolvedValue(
      makeTextResponse('```\n{"value":"plain-block"}\n```')
    );
    const result = await runAgent<Simple>({
      system: 'sys',
      userMessage: 'msg',
      schema: SimpleSchema,
    });
    expect(result.value).toBe('plain-block');
  });

  it('throws ZodError when response fails schema validation', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('{"wrong_field":123}'));
    await expect(
      runAgent<Simple>({ system: 'sys', userMessage: 'msg', schema: SimpleSchema })
    ).rejects.toThrow();
  });

  it('throws when response content is not text type', async () => {
    mockMessagesCreate.mockResolvedValue({ content: [{ type: 'tool_use', id: 'x' }] });
    await expect(
      runAgent<Simple>({ system: 'sys', userMessage: 'msg', schema: SimpleSchema })
    ).rejects.toThrow('Unexpected response type: tool_use');
  });

  it('throws when JSON is malformed', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('not-valid-json'));
    await expect(
      runAgent<Simple>({ system: 'sys', userMessage: 'msg', schema: SimpleSchema })
    ).rejects.toThrow();
  });

  it('uses claude-sonnet-4-6 as default model', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('{"value":"x"}'));
    await runAgent<Simple>({ system: 'sys', userMessage: 'msg', schema: SimpleSchema });
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' })
    );
  });

  it('uses provided model override', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('{"value":"x"}'));
    await runAgent<Simple>({
      system: 'sys', userMessage: 'msg', schema: SimpleSchema,
      model: 'claude-opus-4-6',
    });
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-opus-4-6' })
    );
  });

  it('uses 4096 as default maxTokens', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('{"value":"x"}'));
    await runAgent<Simple>({ system: 'sys', userMessage: 'msg', schema: SimpleSchema });
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 4096 })
    );
  });

  it('uses provided maxTokens override', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('{"value":"x"}'));
    await runAgent<Simple>({
      system: 'sys', userMessage: 'msg', schema: SimpleSchema,
      maxTokens: 8192,
    });
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 8192 })
    );
  });

  it('passes system and userMessage to the API call', async () => {
    mockMessagesCreate.mockResolvedValue(makeTextResponse('{"value":"x"}'));
    await runAgent<Simple>({
      system: 'You are strict.',
      userMessage: 'Do the thing.',
      schema: SimpleSchema,
    });
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are strict.',
        messages: [{ role: 'user', content: 'Do the thing.' }],
      })
    );
  });

  it('propagates network errors from the Anthropic client', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('Network timeout'));
    await expect(
      runAgent<Simple>({ system: 'sys', userMessage: 'msg', schema: SimpleSchema })
    ).rejects.toThrow('Network timeout');
  });

  it('works with array schema (returns array)', async () => {
    const ArraySchema = z.array(z.object({ id: z.number() }));
    mockMessagesCreate.mockResolvedValue(makeTextResponse('[{"id":1},{"id":2}]'));
    const result = await runAgent({
      system: 'sys', userMessage: 'msg', schema: ArraySchema,
    });
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
