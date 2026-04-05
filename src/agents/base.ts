import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.js';

const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export async function runAgent<T>(opts: {
  system: string;
  userMessage: string;
  schema: z.ZodType<T>;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const response = await client.messages.create({
    model: opts.model ?? 'claude-sonnet-4-6',
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: [{ role: 'user', content: opts.userMessage }],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error(`Unexpected response type: ${block.type}`);
  }

  // Extract JSON from the response (handle markdown code blocks)
  const text = block.text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();

  return opts.schema.parse(JSON.parse(text));
}
