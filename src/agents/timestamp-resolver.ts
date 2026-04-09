import type { PrescreenedSegment } from './prescreener.js';
import type { ScoredClip } from './viral-detector.js';

export interface ResolvedClip {
  title: string;
  category: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  hookStrength: number;
  valueDelivery: number;
  clarity: number;
  shareability: number;
  completeness: number;
  totalScore: number;
  transcriptExcerpt: string;
}

function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

function overlaps(a: ResolvedClip, b: ResolvedClip): boolean {
  if (a.startSec >= b.endSec || b.startSec >= a.endSec) return false;
  const overlapDur = Math.min(a.endSec, b.endSec) - Math.max(a.startSec, b.startSec);
  const shorter = Math.min(a.durationSec, b.durationSec);
  return shorter > 0 && overlapDur / shorter > 0.5;
}

export function resolveTimestamps(
  scoredClips: ScoredClip[],
  prescreenedSegments: PrescreenedSegment[],
  videoDurationSec: number,
  bufferSec = 0.5
): ResolvedClip[] {
  if (scoredClips.length === 0 || videoDurationSec <= 0) return [];

  const resolved: ResolvedClip[] = [];

  for (const scored of scoredClips) {
    const seg = prescreenedSegments[scored.segmentIndex];
    if (!seg) {
      console.warn(`[timestamp-resolver] segmentIndex ${scored.segmentIndex} out of bounds — skipping`);
      continue;
    }

    const startSec = Math.max(0, seg.start - bufferSec);
    const endSec = Math.min(videoDurationSec, seg.end + bufferSec);
    const durationSec = endSec - startSec;

    resolved.push({
      title: scored.title,
      category: scored.category,
      startSec,
      endSec,
      durationSec,
      hookStrength: scored.hookStrength,
      valueDelivery: scored.valueDelivery,
      clarity: scored.clarity,
      shareability: scored.shareability,
      completeness: scored.completeness,
      totalScore: scored.totalScore,
      transcriptExcerpt: truncateAtWord(seg.text, 280),
    });
  }

  // Sort by score descending
  resolved.sort((a, b) => b.totalScore - a.totalScore);

  // Deduplicate overlapping clips (keep higher-scoring one — already sorted)
  const deduped: ResolvedClip[] = [];
  for (const clip of resolved) {
    if (!deduped.some(kept => overlaps(kept, clip))) {
      deduped.push(clip);
    }
  }

  return deduped;
}
