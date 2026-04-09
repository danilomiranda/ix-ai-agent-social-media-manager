import path from 'path';

export function assertSafeOutputDir(outputDir: string): void {
  if (!outputDir) {
    throw new Error('outputDir is required');
  }
  const allowed = path.resolve('output');
  const resolved = path.resolve(outputDir);
  if (!resolved.startsWith(allowed + path.sep) && resolved !== allowed) {
    throw new Error(`outputDir "${outputDir}" is outside the allowed output/ directory`);
  }
}
