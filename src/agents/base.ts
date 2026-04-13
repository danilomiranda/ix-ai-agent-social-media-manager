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

  // Extract JSON — handle markdown code blocks and leading prose
  let text = block.text.trim();
  const codeBlock = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlock) {
    text = codeBlock[1].trim();
  } else {
    // Fall back: grab from first { to last }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
  }

  return opts.schema.parse(JSON.parse(text));
}
