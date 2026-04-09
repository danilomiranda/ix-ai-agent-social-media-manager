export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
  score?: number;
}

export interface Segment {
  words: TranscriptWord[];
  start: number;
  end: number;
  text: string;
}

export interface PrescreenedSegment extends Segment {
  densityScore: number;
  hookScore: number;
  sentimentScore: number;
  prescreenTotal: number;
}

const HOOK_PATTERNS = [
  { pattern: /\b\d+[%$kKmMbB]|\$\d+/gu, points: 10, max: 20 },
  { pattern: /(nobody|everyone|always|never|the truth|the real|most people|the problem|the secret)/giu, points: 8, max: 20 },
  { pattern: /(you're wrong|wrong about|think again|actually|in reality|here's what)/giu, points: 5, max: 10 },
  { pattern: /(why does|how do|what if|did you know)/giu, points: 5, max: 10 },
];

const POSITIVE_WORDS = new Set(['win', 'success', 'profit', 'grow', 'achieve', 'breakthrough', 'build', 'earn', 'create', 'solution', 'fixed', 'result']);
const NEGATIVE_WORDS = new Set(['fail', 'lose', 'wrong', 'mistake', 'problem', 'stuck', 'struggle', 'broken', 'waste', 'lost', 'bad', 'worst']);

export function segmentTranscript(words: TranscriptWord[], targetDurSec = 60): Segment[] {
  if (words.length === 0) return [];

  const segments: Segment[] = [];
  const slideBy = 15;
  const videoDuration = words[words.length - 1].end;

  let windowStart = 0;

  while (windowStart < videoDuration) {
    const windowEnd = windowStart + targetDurSec;

    const windowWords = words.filter(w => w.start >= windowStart && w.end <= windowEnd);
    if (windowWords.length > 0) {
      const segStart = windowWords[0].start;
      const segEnd = windowWords[windowWords.length - 1].end;
      const duration = segEnd - segStart;

      if (duration >= 20 && duration <= 95) {
        segments.push({
          words: windowWords,
          start: segStart,
          end: segEnd,
          text: windowWords.map(w => w.word).join(' '),
        });
      }
    }

    windowStart += slideBy;
  }

  return segments;
}

function scoreDensity(seg: Segment): number {
  const duration = seg.end - seg.start;
  if (duration === 0) return 0;
  const wordsPerSec = seg.words.length / duration;
  return Math.min(40, wordsPerSec * 3 * (40 / 9)); // 3 wps → 40 pts
}

function scoreHooks(seg: Segment): number {
  let total = 0;
  for (const { pattern, points, max } of HOOK_PATTERNS) {
    const matches = (seg.text.match(pattern) ?? []).length;
    total += Math.min(max, matches * points);
  }
  return Math.min(40, total);
}

function scoreSentiment(seg: Segment): number {
  const midpoint = Math.floor(seg.words.length / 2);
  const firstHalf = seg.words.slice(0, midpoint).map(w => w.word.toLowerCase());
  const secondHalf = seg.words.slice(midpoint).map(w => w.word.toLowerCase());

  const negFirst = firstHalf.filter(w => NEGATIVE_WORDS.has(w)).length;
  const posSecond = secondHalf.filter(w => POSITIVE_WORDS.has(w)).length;

  if (negFirst > 0 && posSecond > 0) {
    return Math.min(20, (negFirst + posSecond) * 4);
  }
  return 0;
}

export function prescreenSegments(segments: Segment[], topN = 20): PrescreenedSegment[] {
  if (segments.length === 0) return [];

  const scored: PrescreenedSegment[] = segments.map(seg => {
    const densityScore = Math.round(scoreDensity(seg));
    const hookScore = Math.round(scoreHooks(seg));
    const sentimentScore = Math.round(scoreSentiment(seg));
    return {
      ...seg,
      densityScore,
      hookScore,
      sentimentScore,
      prescreenTotal: densityScore + hookScore + sentimentScore,
    };
  });

  return scored
    .sort((a, b) => b.prescreenTotal - a.prescreenTotal)
    .slice(0, topN);
}
