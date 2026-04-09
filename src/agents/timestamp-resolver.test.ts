import { describe, it, expect } from 'vitest';
import { resolveTimestamps, type ResolvedClip } from './timestamp-resolver.js';
import type { PrescreenedSegment } from './prescreener.js';
import type { ScoredClip } from './viral-detector.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePrescreenedSegment(start: number, end: number, text = 'sample text'): PrescreenedSegment {
  return {
    start,
    end,
    text,
    words: text.split(' ').map((word, i) => ({ word, start: start + i, end: start + i + 1 })),
    densityScore: 20,
    hookScore: 10,
    sentimentScore: 5,
    prescreenTotal: 35,
  };
}

function makeScoredClip(segmentIndex: number, totalScore: number): ScoredClip {
  return {
    segmentIndex,
    title: `Clip ${segmentIndex}`,
    category: 'hot_take',
    hookStrength: totalScore / 5,
    valueDelivery: totalScore / 5,
    clarity: totalScore / 5,
    shareability: totalScore / 5,
    completeness: totalScore / 5,
    totalScore,
    reason: 'High energy opening',
  };
}

// ─── resolveTimestamps ───────────────────────────────────────────────────────

describe('resolveTimestamps', () => {
  it('returns empty array when scoredClips is empty', () => {
    const segs = [makePrescreenedSegment(0, 60)];
    expect(resolveTimestamps([], segs, 300)).toEqual([]);
  });

  it('returns empty array when videoDurationSec is 0', () => {
    const segs = [makePrescreenedSegment(0, 60)];
    const clips = [makeScoredClip(0, 350)];
    expect(resolveTimestamps(clips, segs, 0)).toEqual([]);
  });

  it('maps segmentIndex to correct start/end times', () => {
    const segs = [
      makePrescreenedSegment(10, 70),
      makePrescreenedSegment(85, 145),
    ];
    const clips = [makeScoredClip(1, 300)];
    const result = resolveTimestamps(clips, segs, 300, 0); // no buffer

    expect(result).toHaveLength(1);
    expect(result[0].startSec).toBe(85);
    expect(result[0].endSec).toBe(145);
  });

  it('applies buffer correctly', () => {
    const segs = [makePrescreenedSegment(10, 70)];
    const clips = [makeScoredClip(0, 300)];
    const result = resolveTimestamps(clips, segs, 300, 0.5);

    expect(result[0].startSec).toBe(9.5);
    expect(result[0].endSec).toBe(70.5);
  });

  it('clamps startSec to 0', () => {
    const segs = [makePrescreenedSegment(0.2, 60)];
    const clips = [makeScoredClip(0, 300)];
    const result = resolveTimestamps(clips, segs, 300, 0.5);

    expect(result[0].startSec).toBe(0); // 0.2 - 0.5 → clamped to 0
  });

  it('clamps endSec to videoDurationSec', () => {
    const segs = [makePrescreenedSegment(240, 299.8)];
    const clips = [makeScoredClip(0, 300)];
    const result = resolveTimestamps(clips, segs, 300, 0.5);

    expect(result[0].endSec).toBe(300); // 299.8 + 0.5 → clamped to 300
  });

  it('skips out-of-bounds segmentIndex with a warning', () => {
    const segs = [makePrescreenedSegment(0, 60)];
    const clips = [makeScoredClip(99, 400)]; // index 99 doesn't exist
    const result = resolveTimestamps(clips, segs, 300);

    expect(result).toHaveLength(0);
  });

  it('sorts results by totalScore descending', () => {
    const segs = [
      makePrescreenedSegment(0, 60),
      makePrescreenedSegment(90, 150),
      makePrescreenedSegment(180, 240),
    ];
    const clips = [
      makeScoredClip(2, 250),
      makeScoredClip(0, 400),
      makeScoredClip(1, 300),
    ];
    const result = resolveTimestamps(clips, segs, 300, 0);

    expect(result[0].totalScore).toBe(400);
    expect(result[1].totalScore).toBe(300);
    expect(result[2].totalScore).toBe(250);
  });

  it('deduplicates clips with >50% overlap — keeps higher score', () => {
    const segs = [
      makePrescreenedSegment(0, 60),
      makePrescreenedSegment(10, 70), // heavily overlaps with index 0
    ];
    const clips = [
      makeScoredClip(0, 400), // higher score
      makeScoredClip(1, 250), // should be removed
    ];
    const result = resolveTimestamps(clips, segs, 300, 0);

    expect(result).toHaveLength(1);
    expect(result[0].totalScore).toBe(400);
  });

  it('keeps non-overlapping clips', () => {
    const segs = [
      makePrescreenedSegment(0, 55),
      makePrescreenedSegment(120, 175), // no overlap
    ];
    const clips = [
      makeScoredClip(0, 350),
      makeScoredClip(1, 300),
    ];
    const result = resolveTimestamps(clips, segs, 300, 0);

    expect(result).toHaveLength(2);
  });

  it('sets transcriptExcerpt to max 280 chars truncated at word boundary', () => {
    const longText = 'word '.repeat(100).trim(); // 500 chars
    const segs = [makePrescreenedSegment(0, 60, longText)];
    const clips = [makeScoredClip(0, 300)];
    const result = resolveTimestamps(clips, segs, 300);

    expect(result[0].transcriptExcerpt.length).toBeLessThanOrEqual(280);
    // Should not cut mid-word
    expect(result[0].transcriptExcerpt.endsWith(' ')).toBe(false);
  });

  it('computes durationSec correctly', () => {
    const segs = [makePrescreenedSegment(20, 80)];
    const clips = [makeScoredClip(0, 300)];
    const result = resolveTimestamps(clips, segs, 300, 0);

    expect(result[0].durationSec).toBe(60);
  });

  it('includes all 5 score fields in output', () => {
    const segs = [makePrescreenedSegment(0, 60)];
    const clips = [makeScoredClip(0, 300)];
    const result = resolveTimestamps(clips, segs, 300);
    const clip = result[0];

    expect(typeof clip.hookStrength).toBe('number');
    expect(typeof clip.valueDelivery).toBe('number');
    expect(typeof clip.clarity).toBe('number');
    expect(typeof clip.shareability).toBe('number');
    expect(typeof clip.completeness).toBe('number');
  });

  it('preserves category field from scored clip', () => {
    const segs = [makePrescreenedSegment(0, 60)];
    const clips = [{ ...makeScoredClip(0, 300), category: 'data_driven' }];
    const result = resolveTimestamps(clips, segs, 300);
    expect(result[0].category).toBe('data_driven');
  });

  it('clips with exactly 50% overlap are both kept (boundary condition)', () => {
    // clip a: 0–60, clip b: 30–90 → overlap = 30s, shorter = 60s, ratio = 0.5 (not > 0.5)
    const segs = [
      makePrescreenedSegment(0, 60),
      makePrescreenedSegment(30, 90),
    ];
    const clips = [
      makeScoredClip(0, 350),
      makeScoredClip(1, 300),
    ];
    const result = resolveTimestamps(clips, segs, 300, 0);
    // 30/60 = 0.5 which is NOT > 0.5, so both should be kept
    expect(result).toHaveLength(2);
  });
});
