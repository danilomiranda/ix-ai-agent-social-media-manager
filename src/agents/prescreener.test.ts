import { describe, it, expect } from 'vitest';
import {
  segmentTranscript,
  prescreenSegments,
  type TranscriptWord,
} from './prescreener.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWords(count: number, startAt = 0, wordsPerSec = 2.5): TranscriptWord[] {
  return Array.from({ length: count }, (_, i) => ({
    word: `word${i}`,
    start: startAt + i / wordsPerSec,
    end: startAt + (i + 1) / wordsPerSec,
  }));
}

function makeWordsFromText(text: string, startAt = 0, wordsPerSec = 2.5): TranscriptWord[] {
  return text.split(' ').map((word, i) => ({
    word,
    start: startAt + i / wordsPerSec,
    end: startAt + (i + 1) / wordsPerSec,
  }));
}

// ─── segmentTranscript ────────────────────────────────────────────────────────

describe('segmentTranscript', () => {
  it('returns empty array for empty input', () => {
    expect(segmentTranscript([])).toEqual([]);
  });

  it('produces segments from a standard 5-minute transcript', () => {
    const words = makeWords(750, 0, 2.5); // 750 words over 300s
    const segs = segmentTranscript(words);
    expect(segs.length).toBeGreaterThan(0);
    segs.forEach(seg => {
      const dur = seg.end - seg.start;
      expect(dur).toBeGreaterThanOrEqual(20);
      expect(dur).toBeLessThanOrEqual(95);
    });
  });

  it('excludes segments shorter than 20 seconds', () => {
    // Only 10 words in a 5-second window — too short
    const words = makeWords(10, 0, 2);
    const segs = segmentTranscript(words);
    segs.forEach(seg => {
      expect(seg.end - seg.start).toBeGreaterThanOrEqual(20);
    });
  });

  it('each segment contains words and text', () => {
    const words = makeWords(300, 0, 2.5);
    const segs = segmentTranscript(words);
    for (const seg of segs) {
      expect(seg.words.length).toBeGreaterThan(0);
      expect(seg.text).toBeTruthy();
      expect(typeof seg.start).toBe('number');
      expect(typeof seg.end).toBe('number');
    }
  });

  it('produces overlapping windows (slide by 15s)', () => {
    const words = makeWords(600, 0, 2.5); // 240s video
    const segs = segmentTranscript(words);
    // With 15s slide, adjacent segments should overlap
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].start).toBeLessThan(segs[i - 1].end);
    }
  });
});

// ─── prescreenSegments ────────────────────────────────────────────────────────

describe('prescreenSegments', () => {
  it('returns empty array for empty input', () => {
    expect(prescreenSegments([])).toEqual([]);
  });

  it('returns at most topN segments', () => {
    const words = makeWords(900, 0, 2.5);
    const segs = segmentTranscript(words);
    const result = prescreenSegments(segs, 5);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('scores include all three sub-scores', () => {
    const words = makeWords(300, 0, 2.5);
    const segs = segmentTranscript(words);
    const result = prescreenSegments(segs, 10);
    for (const seg of result) {
      expect(typeof seg.densityScore).toBe('number');
      expect(typeof seg.hookScore).toBe('number');
      expect(typeof seg.sentimentScore).toBe('number');
      expect(typeof seg.prescreenTotal).toBe('number');
      expect(seg.prescreenTotal).toBe(seg.densityScore + seg.hookScore + seg.sentimentScore);
    }
  });

  it('results are sorted by prescreenTotal descending', () => {
    const words = makeWords(600, 0, 2.5);
    const segs = segmentTranscript(words);
    const result = prescreenSegments(segs, 20);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].prescreenTotal).toBeLessThanOrEqual(result[i - 1].prescreenTotal);
    }
  });

  it('detects stat hooks (numbers with units)', () => {
    const hookText = '$10M ARR in 6 months 50% growth rate';
    const words = makeWordsFromText(hookText.repeat(30)); // repeat to get 20+ seconds
    const segs = segmentTranscript(words);
    if (segs.length > 0) {
      const result = prescreenSegments(segs, 5);
      expect(result[0].hookScore).toBeGreaterThan(0);
    }
  });

  it('detects bold claim patterns', () => {
    const boldText = 'the truth nobody talks about most people never understand the secret';
    const words = makeWordsFromText(boldText.repeat(20));
    const segs = segmentTranscript(words);
    if (segs.length > 0) {
      const result = prescreenSegments(segs, 5);
      expect(result[0].hookScore).toBeGreaterThan(0);
    }
  });

  it('detects sentiment arc (negative → positive)', () => {
    const firstHalf = 'fail lose wrong mistake problem stuck struggle broken waste'.split(' ');
    const secondHalf = 'win success profit grow achieve breakthrough build earn create'.split(' ');
    const allWords = [...firstHalf, ...secondHalf];
    // Repeat to get a segment long enough
    const words = makeWordsFromText(allWords.join(' ').repeat(8));
    const segs = segmentTranscript(words);
    if (segs.length > 0) {
      const result = prescreenSegments(segs, 5);
      const topSentiment = Math.max(...result.map(s => s.sentimentScore));
      expect(topSentiment).toBeGreaterThan(0);
    }
  });

  it('all score values are non-negative', () => {
    const words = makeWords(400, 0, 2.5);
    const segs = segmentTranscript(words);
    const result = prescreenSegments(segs, 20);
    for (const seg of result) {
      expect(seg.densityScore).toBeGreaterThanOrEqual(0);
      expect(seg.hookScore).toBeGreaterThanOrEqual(0);
      expect(seg.sentimentScore).toBeGreaterThanOrEqual(0);
    }
  });

  it('densityScore does not exceed 40', () => {
    // Very fast speech (10 words/sec)
    const words = makeWords(500, 0, 10);
    const segs = segmentTranscript(words);
    const result = prescreenSegments(segs, 20);
    for (const seg of result) {
      expect(seg.densityScore).toBeLessThanOrEqual(40);
    }
  });

  it('hookScore does not exceed 40', () => {
    const hookText = '$1M $2M $3M the truth nobody everyone always never the secret most people';
    const words = makeWordsFromText(hookText.repeat(10));
    const segs = segmentTranscript(words);
    if (segs.length > 0) {
      const result = prescreenSegments(segs, 5);
      for (const seg of result) {
        expect(seg.hookScore).toBeLessThanOrEqual(40);
      }
    }
  });

  it('prescreenTotal equals densityScore + hookScore + sentimentScore', () => {
    const words = makeWords(300, 0, 2.5);
    const segs = segmentTranscript(words);
    const result = prescreenSegments(segs, 20);
    for (const seg of result) {
      expect(seg.prescreenTotal).toBe(seg.densityScore + seg.hookScore + seg.sentimentScore);
    }
  });

  it('returns 0 segments for a total video shorter than 20 seconds', () => {
    // 10 words at 1 word/sec = 10 second video
    const words = makeWords(10, 0, 1);
    const segs = segmentTranscript(words);
    expect(segs).toHaveLength(0);
  });

  it('sentimentScore is 0 when no negative words in first half', () => {
    const onlyPositive = 'win success profit grow achieve win success grow';
    const words = makeWordsFromText(onlyPositive.repeat(10));
    const segs = segmentTranscript(words);
    if (segs.length > 0) {
      const result = prescreenSegments(segs, 5);
      expect(result[0].sentimentScore).toBe(0);
    }
  });
});
