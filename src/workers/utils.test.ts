import { describe, it, expect } from 'vitest';
import path from 'path';
import { assertSafeOutputDir } from './utils.js';

describe('assertSafeOutputDir', () => {
  const root = path.resolve('.');
  const allowed = path.resolve('output');

  it('passes for a valid subdirectory of output/', () => {
    expect(() => assertSafeOutputDir('output/clips/2026-04-07-test')).not.toThrow();
  });

  it('passes for a deeply nested path inside output/', () => {
    expect(() => assertSafeOutputDir('output/clips/2026-04-07-test/sub')).not.toThrow();
  });

  it('throws for /tmp path', () => {
    expect(() => assertSafeOutputDir('/tmp/evil')).toThrow('outside the allowed output/ directory');
  });

  it('throws for path traversal attempt', () => {
    expect(() => assertSafeOutputDir('output/../../etc/passwd')).toThrow('outside the allowed output/ directory');
  });

  it('throws for project root itself', () => {
    expect(() => assertSafeOutputDir('.')).toThrow('outside the allowed output/ directory');
  });

  it('throws for empty string', () => {
    expect(() => assertSafeOutputDir('')).toThrow('outputDir is required');
  });

  it('throws for undefined cast to string-like', () => {
    expect(() => assertSafeOutputDir(undefined as any)).toThrow('outputDir is required');
  });

  it('throws for sibling directory (output2/)', () => {
    expect(() => assertSafeOutputDir('output2/clips')).toThrow('outside the allowed output/ directory');
  });
});
