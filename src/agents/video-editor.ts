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

## CRITICAL IMPORT RULES — follow exactly, no exceptions

For the source video, ALWAYS use Remotion's built-in Video component:
  import { AbsoluteFill, Video, Audio, useCurrentFrame, useVideoConfig, interpolate, Easing, staticFile, Sequence } from 'remotion';
  // Then render: <Video src={staticFile('path/to/video.mp4')} volume={1} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

For pop-out components, import ONLY from these exact paths (relative to remotion/compositions/):
  import { ConceptOverlay } from '../components/ConceptOverlay';
  import { AppleStylePopup } from '../components/AppleStylePopup';

NEVER import from:
  - '../../components/VideoPlayer' (does NOT exist)
  - '../../components/...' (wrong relative path — compositions are in remotion/compositions/)
  - Any path you are not 100% sure exists

## EXACT COMPONENT PROP INTERFACES — use ONLY these props:

\`\`\`typescript
// AppleStylePopup — white background, premium feel
interface AppleStylePopupProps {
  durationInFrames: number;   // REQUIRED — how long the pop-out stays on screen (in frames)
  illustration: ReactNode;    // REQUIRED — SVG JSX element or emoji in a <span>
  caption?: string;           // Optional — main text label (short, 2-5 words)
  subtitle?: string;          // Optional — secondary line
  illustrationSize?: number;  // Optional — 800 (no text), 700 (with text), 620 (CTA)
  accentColor?: string;       // Optional — hex color, default "#FF7614"
}

// ConceptOverlay — frosted glass full-screen overlay
interface ConceptOverlayProps {
  durationInFrames: number;   // REQUIRED
  illustration: ReactNode;    // REQUIRED
  caption?: string;           // Optional
  subtitle?: string;          // Optional
  illustrationSize?: number;  // Optional
  accentColor?: string;       // Optional
  entrance?: "clip-circle" | "wipe-right" | "fade-blur";  // Optional
  backgroundStyle?: "frosted" | "solid-white" | "dark-blur"; // Optional
}
\`\`\`

NEVER use props named: headline, subtext, emoji, title, text, body, label, content.
ONLY use: durationInFrames, illustration, caption, subtitle, illustrationSize, accentColor.

Word data import (from the composition file):
  import { WORDS, TOTAL_DURATION_FRAMES } from '../data/<compositionId-lowercase>-words';

## Composition Rules
- FPS: 30. Portrait: 1080x1920.
- Use ConceptOverlay OR AppleStylePopup for pop-outs. Never both in the same composition.
- Pop-outs fire at EXACT frame the keyword is spoken: frame = Math.floor(word.start * 30)
- Each pop-out needs a UNIQUE illustration concept expressed as an SVG inline element or emoji string — no repeated metaphors.
- illustrationSize: 800 (no text), 700 (with text), 620 (CTA).
- Source video: volume={1} (speaker audio is the content).
- Background music: <Audio src={staticFile('audio/background-music.mp3')} volume={0.02} endAt={35 * 30} />
- Include 5–12 pop-outs for a 60–90s clip.
- Export a TOTAL_DURATION_FRAMES constant at top of the words file.

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
