import { z } from 'zod';
import { runAgent } from './base.js';
import type { PrescreenedSegment } from './prescreener.js';

export const ScoredClipSchema = z.object({
  segmentIndex: z.number(),
  title: z.string(),
  category: z.string(),
  hookStrength: z.number().min(0).max(100),
  valueDelivery: z.number().min(0).max(100),
  clarity: z.number().min(0).max(100),
  shareability: z.number().min(0).max(100),
  completeness: z.number().min(0).max(100),
  totalScore: z.number().min(0).max(500),
  reason: z.string(),
});

export const ScoredClipsSchema = z.array(ScoredClipSchema);
export type ScoredClip = z.infer<typeof ScoredClipSchema>;

const SYSTEM_PROMPT = `You are a viral content analyst for short-form video. You receive transcript segments and score each for viral potential on social media (TikTok, Instagram Reels, YouTube Shorts).

Score each segment on these 5 dimensions (0–100 each):
- hookStrength: Does the opening sentence immediately grab attention?
- valueDelivery: Does the segment teach, reveal, or entertain clearly?
- clarity: Is the content easy to follow without visual context?
- shareability: Would someone send this to a friend? Is it quotable?
- completeness: Does it feel like a complete thought with a beginning and end?

totalScore = sum of all 5 (max 500).

Return ONLY a JSON array. Each object must include: segmentIndex, title, category, hookStrength, valueDelivery, clarity, shareability, completeness, totalScore, reason.

Only include segments with totalScore >= 200. Omit weak segments entirely.`;

function buildUserMessage(segments: PrescreenedSegment[]): string {
  const list = segments.map((s, i) =>
    `[${i}] (${s.start.toFixed(1)}s–${s.end.toFixed(1)}s, ${s.words.length} words)\n"${s.text.slice(0, 500)}"`
  ).join('\n\n');
  return `Score these ${segments.length} transcript segments:\n\n${list}`;
}

export async function runViralDetectorAgent(segments: PrescreenedSegment[]): Promise<ScoredClip[]> {
  if (segments.length === 0) return [];

  return runAgent({
    system: SYSTEM_PROMPT,
    userMessage: buildUserMessage(segments),
    schema: ScoredClipsSchema,
    maxTokens: 4096,
  });
}
