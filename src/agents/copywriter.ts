import { z } from 'zod';
import { runAgent } from './base.js';

export const PlatformCopySchema = z.object({
  platform: z.string(),
  title: z.string().optional(),
  caption: z.string(),
  hashtags: z.array(z.string()),
  charCount: z.number(),
});

export const PlatformCopyArraySchema = z.array(PlatformCopySchema);
export type PlatformCopy = z.infer<typeof PlatformCopySchema>;

const PLATFORM_LIMITS: Record<string, { caption: number; hashtags: [number, number]; title?: number }> = {
  tiktok:    { caption: 2200,  hashtags: [3, 5] },
  instagram: { caption: 2200,  hashtags: [5, 10] },
  youtube:   { caption: 5000,  hashtags: [5, 8],  title: 100 },
  linkedin:  { caption: 3000,  hashtags: [3, 5],  title: 150 },
  twitter:   { caption: 280,   hashtags: [1, 2] },
  bluesky:   { caption: 300,   hashtags: [2, 3] },
  threads:   { caption: 500,   hashtags: [2, 3] },
};

const SYSTEM_PROMPT = `You write social media copy for Danilo Miranda — AI educator and content creator.

Voice rules (MANDATORY):
- Educator-who-corrects-the-room tone. Not a marketer. Not a hype guy.
- Open with the bold claim or result. Never "Hey guys!" or rhetorical questions.
- Short sentences. Simple words. No fluff.
- CTA at the end only — brief, not pushy.
- BANNED WORDS: leverage, optimize, synergy, game-changing, utilize, empower, crucial, unlock, dive into.
- Each platform gets completely different wording — never copy-paste across platforms.

Platform character limits to respect:
- TikTok: 2200 chars caption, 3–5 hashtags
- Instagram: 2200 chars caption, 5–10 hashtags
- YouTube: 5000 chars description, 5–8 hashtags, title required (max 100 chars)
- LinkedIn: 3000 chars caption, 3–5 hashtags, title optional
- Twitter/X: 280 chars caption, 1–2 hashtags
- Bluesky: 300 chars caption, 2–3 hashtags
- Threads: 500 chars caption, 2–3 hashtags

Return JSON array with one entry per platform. Each entry must have: platform, caption, hashtags (array of strings WITHOUT # prefix), charCount. Add title only for YouTube and LinkedIn.`;

function buildUserMessage(opts: {
  clipTitle: string;
  transcriptExcerpt: string;
  platforms: string[];
}): string {
  const excerpt = opts.transcriptExcerpt.slice(0, 400);
  return `Write social media copy for this clip:

Title: ${opts.clipTitle}
Transcript excerpt: "${excerpt}"

Generate copy for these platforms: ${opts.platforms.join(', ')}`;
}

export async function runCopywriterAgent(opts: {
  clipTitle: string;
  transcriptExcerpt: string;
  platforms: string[];
  initiative?: string;
}): Promise<PlatformCopy[]> {
  if (opts.platforms.length === 0) return [];

  const result = await runAgent({
    system: SYSTEM_PROMPT,
    userMessage: buildUserMessage(opts),
    schema: PlatformCopyArraySchema,
    maxTokens: 4096,
  });

  // Strip accidental # prefix from hashtags
  return result.map(copy => ({
    ...copy,
    hashtags: copy.hashtags.map(h => h.replace(/^#/, '')),
  }));
}
