import { z } from 'zod';
import { runAgent } from './base.js';
import type { TranscriptWord } from './prescreener.js';

export const VideoEditorOutputSchema = z.object({
  tsxContent: z.string().min(100),
  wordsContent: z.string().min(50),
  compositionName: z.string(),
  totalDurationFrames: z.number(),
});

export type VideoEditorOutput = z.infer<typeof VideoEditorOutputSchema>;

const SYSTEM_PROMPT = `You generate Remotion TypeScript composition files for short-form vertical video editing (1080x1920, 30fps).

Rules:
- FPS: 30. Portrait: 1080x1920.
- Use ConceptOverlay or AppleStylePopup for pop-outs. Never use both in the same composition.
- Pop-outs fire at EXACT frame the keyword is spoken: frame = Math.floor(word.start * 30)
- Each pop-out needs a UNIQUE illustration concept expressed as an SVG inline element or emoji string — no repeated metaphors.
- illustrationSize: 800 (no text), 700 (with text), 620 (CTA).
- Source video: use staticFile() for the path. Set volume={1} (speaker audio is the content).
- Background music: import from staticFile('audio/background-music.mp3'), volume={0.02}, first 35s only.
- Include 5–12 pop-outs for a 60–90s clip.
- Export a TOTAL_DURATION_FRAMES constant at top of the words file.
- The composition must import its word data from ../../data/<compositionId-lowercase>-words.
- Use SFX from public/audio/: pop-402324.mp3 for pop-outs, whoosh variants for transitions.

Return JSON with exactly these fields:
- tsxContent: the full .tsx composition file as a string
- wordsContent: the .ts word-timing data file as a string
- compositionName: the PascalCase composition ID
- totalDurationFrames: integer frame count at 30fps`;

function buildUserMessage(opts: {
  compositionId: string;
  clipTitle: string;
  durationSec: number;
  transcriptExcerpt: string;
  wordsJson: TranscriptWord[];
  reframedVideoPath: string;
}): string {
  const frames = Math.floor(opts.durationSec * 30);
  const wordSample = opts.wordsJson.slice(0, 200);

  return `Create a Remotion composition for this clip:

Title: ${opts.clipTitle}
Duration: ${opts.durationSec.toFixed(1)}s (${frames} frames)
Composition ID: ${opts.compositionId}
Video path (use with staticFile()): ${opts.reframedVideoPath}

Transcript excerpt: "${opts.transcriptExcerpt}"

Word timestamps for pop-out timing (first 200 words):
${JSON.stringify(wordSample, null, 2)}`;
}

export async function runVideoEditorAgent(opts: {
  compositionId: string;
  clipTitle: string;
  durationSec: number;
  transcriptExcerpt: string;
  wordsJson: TranscriptWord[];
  reframedVideoPath: string;
}): Promise<VideoEditorOutput> {
  return runAgent({
    system: SYSTEM_PROMPT,
    userMessage: buildUserMessage(opts),
    schema: VideoEditorOutputSchema,
    maxTokens: 8192,
  });
}
