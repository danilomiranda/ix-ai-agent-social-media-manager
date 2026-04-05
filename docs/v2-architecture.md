# V2 System Architecture — IX AI Orchestration Platform

> Date: 2026-04-04 (revised 2026-04-05)
> Author: Architecture session with Claude Code

---

## 1. REPOSITORY ANALYSIS

### Current Architecture

The system is a **Claude Code agent-native monorepo** — not a traditional backend. The "runtime" is Claude Code itself, executing skills (structured prompt files) that orchestrate shell commands, Python tools, and external APIs. There is no server, no queue, no database. Persistence is via files.

**Module Map:**

```
.claude/skills/          → Agent behavior definitions (SKILL.md files)
tools/clip_extractor/    → Python CV pipeline (face detection, Kalman tracking, FFmpeg render)
remotion/               → React/TypeScript video composition engine
public/                 → Brand assets (logos, SFX, music)
output/                 → All generated artifacts
sessions/               → Session logs (markdown)
references/             → Scoring + selection frameworks (prompt context)
```

**Current Data Flow:**

```
Long-form video (local file)
  → [clip-selection] LLM analyzes SRT transcript → scores clips → produces clip_definitions.json
  → [clip-extractor] Python: MediaPipe face detect → Kalman smooth → deadzone filter → FFmpeg render → 9:16 mp4
  → [edit] LLM writes Remotion .tsx composition + word-timed pop-out data
  → [npm run render] Remotion renders → mp4
  → [short-form-posting] curl Late API → published
```

**Python clip_extractor pipeline (6 stages):**
1. `FaceDetector` (MediaPipe BlazeFace / OpenCV DNN)
2. `PoseEstimator` + `SaliencyDetector` → `fuse_signals()`
3. `TemporalSmoother` (Kalman or EMA)
4. `DeadzoneFilter` (suppresses micro-jitter)
5. `CropCalculator` (9:16 or 1:1 window computation)
6. `crop_renderer` → frame-by-frame FFmpeg pipe

**Strengths:**
- Clip extraction pipeline is genuinely sophisticated (Kalman tracking, multi-signal fusion, split-screen auto-detection, webcam overlay detection)
- Skill system is well-structured and consistent — each skill is self-contained with phases, anti-patterns, and output contracts
- Voice DNA establishes consistent brand identity at the prompt level
- Scoring framework is rigorous (5-category, 0-100 with tiebreaker rules)
- Remotion enables programmatic, frame-precise video editing at zero-cost render time
- Session tracking creates an audit trail

**Limitations and Gaps (what blocks scaling):**

| Gap | Impact |
|-----|--------|
| No ingestion queue — files must be manually placed | Can't handle incoming webhooks or bulk processing |
| No transcript → clip automation trigger | Requires human to invoke each step |
| Zero persistent state (no DB) | Can't track cross-session analytics, multi-asset relationships, or content performance feedback loops |
| No A/B performance feedback into scoring | Scoring stays static — doesn't learn which clips actually performed |
| Single-tenant, local-only | Can't productize or serve multiple clients |
| Remotion render is CPU-bound, blocking | Can't parallelize renders |
| No lead/outreach automation | Consulting and music use cases are completely unaddressed |
| No CRM integration | No pipeline for lead capture from content |
| Late API is the only distribution layer | No retry logic, no queue, no fallback |
| No scheduled/autonomous execution | Everything requires a human to type a command |

---

## 2. TARGET ARCHITECTURE (V2 SYSTEM)

### Language Split — Python Only Where It Has Real Advantages

Python and Node.js split on a hard rule: **Python for ML/CV, Node.js for everything else.**

| Domain | Runtime | Reason |
|--------|---------|--------|
| Face detection + tracking | **Python** | MediaPipe, OpenCV, TFLite/ONNX — no Node.js equivalent |
| Kalman smoother, signal fusion | **Python** | NumPy, filterpy — numerical stack |
| Transcription (WhisperX) | **Python** | GPU ML library, Python-only |
| NLP preprocessing (VADER, spaCy) | **Python** | No Node.js equivalent at this quality |
| Web server | **Node.js** | Fastify — your comfort zone, faster than FastAPI |
| Job queue + workers | **Node.js** | BullMQ — TypeScript-native, more mature than ARQ |
| AI agent calls (Claude API) | **Node.js** | `@anthropic-ai/sdk` — official, first-class |
| Database ORM | **Node.js** | Prisma or Drizzle |
| File watcher | **Node.js** | chokidar |
| All REST API clients | **Node.js** | axios/got |
| Cron scheduling | **Node.js** | BullMQ cron jobs |
| Remotion rendering | **Node.js** | Already Node.js |
| Business logic (agents, copy, leads) | **Node.js** | |

**Python becomes two headless CLI tools**, invoked via `child_process.spawn` from Node.js workers:

```
Node.js (orchestrator — everything)
  └── child_process.spawn → Python (CV + transcription only)
        ├── python -m clip_extractor reframe --video ... --output ...
        └── python -m transcriber --video ... --output ...
```

Python processes are fire-and-forget subprocesses. They write output to disk. Node.js reads the result. No Python HTTP server needed.

---

### Design Philosophy

**Monorepo, modular services.** Not microservices — you're one person. The system should be deployable as a single process on a single machine, but factored so each domain can be extracted into a service when you need to scale. The decision boundary is: "does this need to run while I'm asleep?" If yes, it needs to be a background worker.

**Layered architecture:**

```
┌───────────────────────────────────────────────────────────┐
│                    INGESTION LAYER                        │
│  Watch folders / Webhooks / RSS / Manual drop             │
├───────────────────────────────────────────────────────────┤
│                   PROCESSING LAYER                        │
│  Transcription · Face tracking · Clip extraction          │
├───────────────────────────────────────────────────────────┤
│              CONTENT INTELLIGENCE LAYER                   │
│  Viral scoring · Hook analysis · Topic clustering         │
├───────────────────────────────────────────────────────────┤
│               TRANSFORMATION LAYER                        │
│  Remotion edit · Caption gen · Thumbnail · Carousel       │
├───────────────────────────────────────────────────────────┤
│                 DISTRIBUTION LAYER                        │
│  Late API · Direct APIs · Scheduling · Queue              │
├───────────────────────────────────────────────────────────┤
│                     DATA LAYER                            │
│  SQLite → Postgres · Vector DB · Analytics · Feedback     │
└───────────────────────────────────────────────────────────┘
```

### Target Folder Structure

```
ix-platform/
├── src/                            # Node.js — all orchestration + business logic
│   │
│   ├── api/                        # Fastify web server
│   │   ├── server.ts               # Fastify app setup
│   │   ├── routes/
│   │   │   ├── ingest.ts           # POST /ingest — receive video + metadata
│   │   │   ├── jobs.ts             # GET /jobs/:id — status polling
│   │   │   ├── clips.ts            # GET /clips/pending, POST /clips/:id/approve
│   │   │   └── webhooks.ts         # YouTube/Late push callbacks
│   │   └── auth.ts                 # API key middleware
│   │
│   ├── workers/                    # BullMQ workers — one file per queue
│   │   ├── transcribe.worker.ts    # spawn Python transcriber subprocess
│   │   ├── select.worker.ts        # Claude API clip selection
│   │   ├── reframe.worker.ts       # spawn Python clip_extractor subprocess
│   │   ├── edit.worker.ts          # Remotion render (npx remotion render)
│   │   ├── publish.worker.ts       # Late API distribution
│   │   └── feedback.worker.ts      # Analytics pull → scoring weights update
│   │
│   ├── agents/                     # Claude API agents (Anthropic SDK)
│   │   ├── base.ts                 # Shared run_agent() wrapper
│   │   ├── clip-selector.ts        # Viral moment detection + scoring
│   │   ├── copywriter.ts           # Platform-specific post copy
│   │   ├── strategist.ts           # Content calendar decisions
│   │   ├── growth.ts               # SEO, hashtags, trends
│   │   └── outreach.ts             # Consulting + music venue outreach
│   │
│   ├── intelligence/               # Deterministic pre-scoring (no LLM)
│   │   ├── viral-prescreener.ts    # Regex patterns, density, filler detection
│   │   └── sentiment.ts            # Sentiment volatility via simple scoring
│   │
│   ├── distribution/               # Publishing layer
│   │   ├── late-client.ts          # Late API client with retry (tenacity-style)
│   │   └── platform-adapters/      # Per-platform copy formatting rules
│   │       ├── youtube.ts
│   │       ├── tiktok.ts
│   │       ├── linkedin.ts
│   │       └── instagram.ts
│   │
│   ├── business/                   # Business integrations
│   │   ├── consulting/
│   │   │   ├── case-study-gen.ts   # CaseStudy agent wrapper
│   │   │   ├── lead-magnet-gen.ts
│   │   │   └── notion-crm.ts       # Notion API client
│   │   └── music/
│   │       ├── venue-outreach.ts
│   │       └── show-packager.ts
│   │
│   ├── db/                         # Prisma ORM
│   │   ├── schema.prisma
│   │   └── client.ts
│   │
│   ├── queue/                      # BullMQ queue definitions
│   │   └── queues.ts
│   │
│   ├── ingestion/                  # Event sources
│   │   ├── watcher.ts              # chokidar file watcher
│   │   └── rss.ts                  # Podcast RSS poller
│   │
│   └── config.ts                   # Env config with zod validation
│
├── python/                         # Python — CV + transcription ONLY
│   ├── transcriber/
│   │   ├── __main__.py             # CLI: python -m transcriber --video ... --output ...
│   │   └── whisperx_runner.py      # WhisperX → .srt + .words.json
│   └── clip_extractor/             # Existing tools/clip_extractor/ (moved here)
│       └── ...                     # Unchanged
│
├── remotion/                       # Existing Remotion (unchanged)
├── .claude/                        # Existing skill system (unchanged)
├── tools/                          # srt_to_words.py + legacy (keep for now)
│
├── prisma/
│   └── schema.prisma
├── docker-compose.yml              # Redis only (no Python container needed)
├── pyproject.toml                  # Python deps — CV stack only
├── package.json                    # Node deps — everything else
└── tsconfig.json
```

### Database Schema (Prisma)

```prisma
// prisma/schema.prisma

datasource db {
  provider = "sqlite"   // → "postgresql" when moving to prod
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

model Source {
  id          String   @id @default(cuid())
  type        String   // 'youtube_video' | 'local_file' | 'podcast'
  url         String?
  filePath    String?
  title       String?
  durationSec Float?
  initiative  String   // 'social_engine' | 'dark_channel' | 'consulting' | 'music'
  status      String   @default("pending")
  createdAt   DateTime @default(now())
  jobs        Job[]
  clips       Clip[]
}

model Job {
  id          String    @id @default(cuid())
  sourceId    String
  source      Source    @relation(fields: [sourceId], references: [id])
  type        String    // 'transcribe' | 'select' | 'reframe' | 'edit' | 'publish'
  status      String    @default("queued")
  input       String?   // JSON
  output      String?   // JSON
  error       String?
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime  @default(now())
}

model Clip {
  id                String   @id @default(cuid())
  sourceId          String
  source            Source   @relation(fields: [sourceId], references: [id])
  title             String?
  startSec          Float?
  endSec            Float?
  hookStrength      Int?
  valueDelivery     Int?
  clarity           Int?
  shareability      Int?
  completeness      Int?
  totalScore        Int?
  category          String?
  filePath          String?  // reframed 9:16 output
  editedPath        String?  // Remotion render output
  transcriptExcerpt String?
  createdAt         DateTime @default(now())
  posts             Post[]
}

model Post {
  id          String    @id @default(cuid())
  clipId      String
  clip        Clip      @relation(fields: [clipId], references: [id])
  platform    String
  latePostId  String?
  title       String?
  caption     String?
  hashtags    String?   // JSON array
  status      String?
  publishedAt DateTime?
  views       Int       @default(0)
  likes       Int       @default(0)
  shares      Int       @default(0)
  comments    Int       @default(0)
  createdAt   DateTime  @default(now())
}

model Lead {
  id        String   @id @default(cuid())
  source    String?  // 'youtube_comment' | 'linkedin_dm' | 'email'
  initiative String? // 'consulting' | 'music'
  name      String?
  contact   String?
  content   String?
  score     Int?
  status    String   @default("new")
  createdAt DateTime @default(now())
}
```

### Monolith vs Microservices Recommendation

**Stay monolith, factor into workers.** The bottleneck is compute (transcription, face tracking, rendering), not request volume. A single Python process with async workers (ARQ backed by Redis) handles parallelism without the ops overhead of containers per service. Extract only what genuinely needs to run independently:

- `processing/reframer` → already a Python package, stays local
- `remotion` render → Node subprocess, stays local
- API layer → can be extracted to a separate FastAPI process if you open it to clients

---

## 3. AI AGENT DESIGN

Use the **Claude API** for all agents via the official `@anthropic-ai/sdk` Node.js package. Each agent is a TypeScript function that constructs a system prompt, assembles context, calls Claude, and returns a typed object. No LangChain, no framework overhead.

### Agent Pattern (shared)

```typescript
// src/agents/base.ts
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env

export async function runAgent<T>(opts: {
  system: string;
  userMessage: string;
  schema: z.ZodType<T>;
  model?: string;
}): Promise<T> {
  const response = await client.messages.create({
    model: opts.model ?? 'claude-opus-4-6',
    max_tokens: 4096,
    system: opts.system,
    messages: [{ role: 'user', content: opts.userMessage }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  return opts.schema.parse(JSON.parse(text));
}
```

---

### Agent 1: Content Strategist Agent

**Purpose:** Given a long-form video transcript + channel analytics, decide what content to produce, for which platforms, and when.

**Input:**
```typescript
interface ContentStrategyInput {
  transcriptSummary: string;       // 500-word LLM summary of video
  channelAnalytics: object;        // Top posts, avg engagement, follower segments
  trendingTopics: string[];        // From trend monitor
  contentBacklog: string[];        // Pending clips not yet posted
  voiceDna: string;                // Full Voice DNA profile
}
```

**Output:**
```typescript
const ContentPlanSchema = z.object({
  priorityClips: z.array(z.string()),            // Clip IDs ranked by priority
  platformMatrix: z.record(z.array(z.string())), // { tiktok: [clip_1], linkedin: [clip_2] }
  postingSchedule: z.array(z.object({
    clipId: z.string(),
    platform: z.string(),
    scheduledAt: z.string(),        // ISO datetime
  })),
  contentGaps: z.array(z.string()),
  recommendedHooks: z.array(z.string()),
});
type ContentPlan = z.infer<typeof ContentPlanSchema>;
```

**System prompt strategy:**
```
You are a content strategist for a solo creator who is also an AI consultant
and musician. Your job is to maximize reach and authority simultaneously.

Rules:
- Educational + tactical content → LinkedIn + YouTube
- Personal story + entertaining → TikTok + Reels
- Authority positioning → LinkedIn long-form
- Never recommend posting the same message twice in a 7-day window
- Consulting CTAs belong on LinkedIn, not TikTok
- Music content belongs on YouTube Shorts + Instagram Reels
```

**Memory/context:** Last 30 days of performance data + content calendar injected as context.

---

### Agent 2: Viral Clip Detector Agent

**Purpose:** Score transcript segments for short-form virality potential. This is the LLM layer of the scoring pipeline — heuristics handle syntax, LLM handles semantics.

**Input:**
```typescript
interface TranscriptSegment {
  text: string;
  startSec: number;
  endSec: number;
  duration: number;
}

interface ViralDetectorInput {
  segments: TranscriptSegment[];
  sourceCategory: 'podcast' | 'tutorial' | 'performance' | 'case_study';
  targetDurationRange: [number, number]; // [45, 90]
  previousScores?: Array<{ category: string; avgScore: number; avgEngagement: number }>;
}
```

**Output:**
```typescript
const ScoredClipSchema = z.object({
  startWords: z.string(),        // Verbatim anchor, 5-8 words
  endWords: z.string(),
  startSecEstimate: z.number(),
  endSecEstimate: z.number(),
  hookStrength: z.number(),      // 0-20
  valueDelivery: z.number(),
  clarity: z.number(),
  shareability: z.number(),
  completeness: z.number(),
  totalScore: z.number(),
  category: z.string(),
  hookPattern: z.string(),       // "bold_claim" | "stat" | "problem_statement" | "reframe"
  bestImprovement: z.string(),
});
```

**Deterministic pre-filters (run before LLM call):**
```typescript
// src/intelligence/viral-prescreener.ts
function prescreenSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments.filter(seg => {
    if (/^(so|um|okay|anyway|like i was)/i.test(seg.text.trim())) return false;
    if (seg.duration < 40 || seg.duration > 95) return false;
    const wordCount = seg.text.split(/\s+/).length;
    if (wordCount / seg.duration < 1.5) return false; // too sparse
    return true;
  });
}
```

**Where LLM vs deterministic:**

| Decision | Who |
|----------|-----|
| Duration bounds | Deterministic |
| Filler phrase filter | Deterministic (regex) |
| Sentence completeness | Deterministic (end punctuation check) |
| Hook quality (semantic) | LLM |
| Value delivery (semantic) | LLM |
| Shareability (audience empathy) | LLM |
| Timestamp boundary refinement | Deterministic (fuzzy match on SRT) |

---

### Agent 3: Video Editor Agent

**Purpose:** Generate Remotion composition code (.tsx) and word-timed pop-out data (.ts) for a given clip + scoring context.

**Input:**
```typescript
interface EditRequest {
  clipPath: string;
  transcriptSrt: string;
  score: z.infer<typeof ScoredClipSchema>;
  format: 'short-form-pipeline' | 'short-form-standalone' | 'long-form';
  styleVariant: string;       // From remotion/playbook/styles/
  ctaText?: string;
  sourceVideoTitle?: string;
}
```

**Output:** Generated `.tsx` file content + `.ts` word data file content (returned as strings, written to disk by caller).

**Memory/context:** Last 3 composition files as few-shot examples + illustration library index.

---

### Agent 4: Copywriting Agent

**Purpose:** Generate platform-specific post copy that matches Voice DNA.

**Input:**
```typescript
interface CopyRequest {
  clipScore: z.infer<typeof ScoredClipSchema>;
  transcriptExcerpt: string;
  platform: 'twitter' | 'linkedin' | 'instagram' | 'tiktok' | 'youtube';
  voiceDna: string;
  postHistory: string[];         // Last 10 posts on this platform (dedup check)
}
```

**Output:**
```typescript
const PlatformCopySchema = z.object({
  platform: z.string(),
  title: z.string().optional(),  // YouTube only
  body: z.string(),
  hashtags: z.array(z.string()),
  cta: z.string(),
  charCount: z.number(),
  hookType: z.string(),
});
```

**Platform constraints baked into system prompt:**

```
Twitter:   280 chars, hook on line 1, no hashtags in body
LinkedIn:  1200-1800 chars, hook + 3-5 insight bullets + CTA, 3-5 hashtags
TikTok:    100-150 chars, match clip energy, 3-5 hashtags
Instagram: 125 chars visible before fold (put hook there), hashtags in first comment
YouTube:   SEO title 60 chars, description with timestamps, 500-word body
```

---

### Agent 5: Growth Agent

**Purpose:** Research trends, generate hashtag sets, suggest content angles.

**Output:**
```typescript
const GrowthPackageSchema = z.object({
  trendingHashtags: z.array(z.string()),
  trendingAudio: z.array(z.string()),          // TikTok/Reels audio trends
  competitorHooks: z.array(z.string()),
  contentAngleVariations: z.array(z.string()),
  optimalPostTimes: z.record(z.string()),       // { tiktok: "18:00-20:00 EST" }
});
```

---

### Agent 6: Outreach Agent

**Purpose:** Generate personalized outreach for consulting leads and venue bookings.

**Input:**
```typescript
interface OutreachTarget {
  targetType: 'consulting_lead' | 'venue' | 'collaborator';
  targetName: string;
  targetDescription: string;
  context: string;
  offer: string;
  yourRecentContent: string[];
}
```

**Output:**
```typescript
const OutreachMessageSchema = z.object({
  subject: z.string(),
  body: z.string(),
  followUpDay3: z.string(),
  followUpDay7: z.string(),
  personalizationSignals: z.array(z.string()),
});
```

---

## 4. VIDEO → SHORTS PIPELINE (DETAILED)

### Full Pipeline

```
INPUT: long-form video (.mp4, .mov)
         │
         ▼
┌─────────────────────┐
│  TRANSCRIPTION      │  WhisperX (local GPU) or AssemblyAI (fallback)
│  Output: .srt +     │  → word-level timestamps, speaker diarization
│  .words.json        │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  SEMANTIC           │  Python: sentence-group the word stream
│  SEGMENTATION       │  → preserve natural phrase boundaries
│  Output: segments[] │  → reject segments with filler starts
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  VIRAL SCORING      │  Phase 1: Deterministic prescreen (regex + timing)
│  (Hybrid)           │  Phase 2: Claude API → 5-category scores + anchors
│  Output: scored     │  Phase 3: Fuzzy-match anchors → exact SRT timestamps
│  selections JSON    │  (rapidfuzz, existing tools/clip_extractor/selection/)
└────────┬────────────┘
         │  ← USER APPROVAL GATE
         ▼
┌─────────────────────┐
│  CLIP EXTRACTION    │  Python: tools/clip_extractor/ (existing, unchanged)
│  (face-track        │  → MediaPipe BlazeFace / OpenCV DNN
│   reframe)          │  → Kalman smoother + deadzone filter
│  Output: 9:16 mp4s  │  → Frame-by-frame FFmpeg pipe render
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  SUBTITLE GEN       │  tools/srt_to_words.py → word-timed .ts data
│  + WORD DATA        │  → per-frame word highlighting in Remotion
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  REMOTION EDIT      │  Claude API → writes .tsx composition
│  (programmatic)     │  → ConceptOverlay / AppleStylePopup pop-outs
│  Output: .tsx +     │  → KIE.ai illustrations per pop-out
│  .ts words data     │  → SFX J-cuts, background music 0.02
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  RENDER             │  npx remotion render (Node subprocess)
│  Output: final .mp4 │  → 1080x1920 @ 30fps
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│  COPY + THUMBNAIL   │  Claude API → platform-specific copy
│                     │  KIE.ai → thumbnail concept + face composite
└────────┬────────────┘
         │  ← USER APPROVAL GATE
         ▼
┌─────────────────────┐
│  DISTRIBUTION       │  Late API → TikTok + Reels + Shorts + LinkedIn
│  Output: post IDs   │  → scheduled or immediate
└─────────────────────┘
```

### Viral Moment Detection — Signal Stack

**Signal 1 — Information Density (deterministic)**
```typescript
// src/intelligence/viral-prescreener.ts
function informationDensityScore(segment: TranscriptSegment): number {
  const words = segment.text.split(/\s+/);
  const wordsPerSec = words.length / segment.duration;
  // Count unique content words (skip stopwords)
  const stopwords = new Set(['the','a','an','is','it','of','and','or','in','to','for']);
  const contentWords = new Set(words.filter(w => !stopwords.has(w.toLowerCase())));
  const uniqueRatio = contentWords.size / words.length;
  return (wordsPerSec * 0.6) + (uniqueRatio * 40);
}
```

**Signal 2 — Pattern Matching (deterministic)**
```typescript
const VIRAL_PATTERNS: Record<string, RegExp> = {
  stat_hook:     /\b\d+[%xX]?\b.*\b(in|within|after)\b.*\b(days?|weeks?|months?)\b/i,
  bold_claim:    /^(The (truth|reality|problem|issue)|Most people|Nobody tells you|Stop)/i,
  reframe:       /\b(actually|wrong|myth|lie|mistake)\b/i,
  result_reveal: /\b(made|earned|generated|reached|grew)\b.*\b\$?\d+[kKmM]?\b/i,
  framework:     /\b(step \d|rule \d|\d\s+things|formula|system|framework)\b/i,
};

function patternScore(text: string): Record<string, boolean> {
  return Object.fromEntries(
    Object.entries(VIRAL_PATTERNS).map(([k, re]) => [k, re.test(text)])
  );
}
```

**Signal 3 — Sentiment Volatility (deterministic)**
```typescript
// Simple polarity scoring without external deps
const POSITIVE = new Set(['great','amazing','incredible','best','love','perfect','brilliant']);
const NEGATIVE = new Set(['wrong','bad','worst','terrible','broken','fail','mistake']);

function sentimentVolatility(sentences: string[]): number {
  const scores = sentences.map(s => {
    const words = s.toLowerCase().split(/\s+/);
    const pos = words.filter(w => POSITIVE.has(w)).length;
    const neg = words.filter(w => NEGATIVE.has(w)).length;
    return (pos - neg) / Math.max(words.length, 1);
  });
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length;
  return Math.sqrt(variance); // std dev — high = emotional range
}
```

**LLM call strategy:** Run deterministic signals first. Only send **top 20 segments** (by combined score) to Claude for semantic scoring. Cuts API cost ~70% on a 60-minute video.

**Where LLM is non-negotiable:**
- Hook semantic quality
- Value delivery (is this genuinely useful?)
- Shareability (would target audience send this to a friend?)
- Cross-reference check (does clip assume prior context viewers won't have?)

---

## 5. AUTOMATION + ORCHESTRATION

### Queue Architecture (BullMQ + Redis)

```typescript
// src/queue/queues.ts
import { Queue, Worker } from 'bullmq';
import { connection } from './redis';

export const queues = {
  transcribe: new Queue('transcribe', { connection }),
  select:     new Queue('select',     { connection }),
  reframe:    new Queue('reframe',    { connection }),
  edit:       new Queue('edit',       { connection }),
  publish:    new Queue('publish',    { connection }),
};
```

```typescript
// src/workers/transcribe.worker.ts
import { Worker } from 'bullmq';
import { spawn } from 'child_process';
import { queues } from '../queue/queues';

new Worker('transcribe', async (job) => {
  const { sourcePath, outputDir } = job.data;

  // Invoke Python transcriber as subprocess
  await spawnAsync('python', [
    '-m', 'transcriber',
    '--video', sourcePath,
    '--output', outputDir,
  ], { cwd: 'python' });

  // Fan out to next stage
  await queues.select.add('clip-select', {
    transcriptPath: `${outputDir}/transcript.srt`,
    sourcePath,
    parentJobId: job.id,
  });
}, { connection, concurrency: 2 });
```

**Cron jobs (BullMQ scheduler):**
```typescript
import { QueueScheduler } from 'bullmq';

await queues.publish.add('trend-refresh',   {}, { repeat: { cron: '0 9,21 * * *' } });
await queues.publish.add('analytics-pull',  {}, { repeat: { cron: '0 3 * * *'   } });
await queues.publish.add('outreach-batch',  {}, { repeat: { cron: '0 10,15 * * 1-5' } });
```

### Scheduling Matrix

| Task | Trigger | Tool |
|------|---------|------|
| Ingest new video drop | File system event | Watchdog → ARQ |
| Run transcription | On ingest | ARQ chained job |
| Trend refresh | Every 12h | ARQ cron |
| Analytics pull | Daily 3am | ARQ cron |
| Post scheduling | Calendar-based | ARQ cron reading schedule.json |
| Outreach batch | Business hours | ARQ cron |
| Feedback loop | Daily 3am | ARQ cron |

### Python vs Node Responsibilities

| Python | Node.js/TypeScript |
|--------|-------------------|
| Face detection + tracking (MediaPipe, OpenCV) | Everything else |
| Kalman smoother, signal fusion (NumPy, filterpy) | Fastify API server |
| Transcription (WhisperX — GPU ML) | BullMQ job queue + workers |
| NLP preprocessing (vaderSentiment, spaCy) | All Claude API agent calls |
| TFLite/ONNX model inference | Prisma/Drizzle ORM |
| — | chokidar file watcher |
| — | Late/KIE/Notion API clients |
| — | Remotion rendering |
| — | Business logic + outreach |

Python runs as **CLI subprocesses only** — no HTTP server, no long-running Python process.

---

## 6. BUSINESS INTEGRATION LAYER

### Consulting Company

**Content → Authority → Lead pipeline:**

```
Long-form recording (client call, workshop, tutorial)
  → [clip-selection] educational + tactical clips (highest priority)
  → [edit] LinkedIn-optimized short (clean, professional overlay design)
  → [copywriter] LinkedIn post (problem → system → result)
  → [lead_magnet_gen] companion asset (checklist, template, guide)
  → [distribute] LinkedIn + YouTube
  → [lead_capture] "DM me for the template" CTA → inbound DM → CRM entry
```

**Case study generator:**
```typescript
// src/business/consulting/case-study-gen.ts
interface CaseStudyInput {
  clientDescription: string;
  problemBefore: string;
  solutionImplemented: string;
  results: Record<string, string | number>;
  clientQuote?: string;
}

const CaseStudySchema = z.object({
  linkedinPost: z.string(),       // problem → system → result
  shortFormScript: z.string(),    // 60s short
  leadMagnetTitle: z.string(),
  emailSequence: z.array(z.string()),  // 3-email nurture
});
```

**CRM sync (Notion):**
```typescript
// src/business/consulting/notion-crm.ts
import axios from 'axios';

async function logLead(name: string, sourcePostId: string, company?: string) {
  await axios.post('https://api.notion.com/v1/pages', {
    parent: { database_id: process.env.NOTION_LEADS_DB_ID },
    properties: {
      Name:   { title: [{ text: { content: name } }] },
      Source: { rich_text: [{ text: { content: sourcePostId } }] },
      Company:{ rich_text: [{ text: { content: company ?? '' } }] },
      Status: { select: { name: 'New' } },
      Date:   { date: { start: new Date().toISOString() } },
    },
  }, {
    headers: {
      Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
    },
  });
}
```

---

### Music Project

**Content → Audience → Booking funnel:**

```
Performance recording / studio session
  → [clip-selection] "entertaining" + "personal_story" category clips
  → [clip-extractor] upper_body crop mode (face + hands in frame)
  → [edit] Reels/Shorts with performance aesthetic
  → [copywriter] Instagram caption (fan connection tone, not authority tone)
  → [distribute] Instagram + TikTok + YouTube Shorts
  → [show_packager] EPK-style document (bio + setlist + tech rider + rates)
  → [venue_outreach] personalized email to venue booking managers
```

**Note on crop mode:** Current clip extractor is face-center. For guitar performance content, a custom `upper_body` crop mode is needed that centers between face position and wrist keypoints (available from existing `PoseEstimator`). This is a ~50-line change to `tools/clip_extractor/crop/crop_calculator.py`.

**Venue outreach:**
```typescript
// src/business/music/venue-outreach.ts
interface VenueTarget {
  venueName: string;
  venueType: 'bar' | 'theater' | 'festival' | 'restaurant';
  city: string;
  typicalActs: string[];      // Scraped from Instagram
  bookingContact?: string;
  bookingEmail?: string;
}

const ShowPackageSchema = z.object({
  epkPdfPath: z.string(),
  pitchEmail: z.string(),
  followUpEmail: z.string(),
  socialProofLinks: z.array(z.string()),
});
```

Data source for venue targets: Google Places API filtered by category + city (Node.js `@googlemaps/google-maps-services-js`).

---

## 7. MONETIZATION + SAAS STRATEGY

### Three Commercial Surfaces

**Surface 1: API (B2B)**
```
POST /api/v1/jobs/process-video
{
  "video_url": "s3://...",
  "platforms": ["tiktok", "linkedin", "youtube_shorts"],
  "clip_count": 7,
  "voice_profile_id": "uuid"
}
→ Returns job_id
→ Webhooks when done: clip URLs + copy + thumbnails
```

**Surface 2: Dashboard (prosumer)**
Web UI for non-technical creators. Job tracking, clip preview + approval, copy editing, one-click publish.

**Surface 3: White-label (agency)**
Multi-tenant, per-seat billing. Agencies re-selling the system to clients.

### MVP SaaS Build Order

**Phase 1 — API only (weeks 1-4)**
- Video upload → transcription → clip selection → reframe → download
- Authentication: API keys
- Billing: usage-based (per minute of video processed)
- Stack: FastAPI + SQLite → Postgres + S3/R2 + Stripe

**Phase 2 — Dashboard (weeks 5-10)**
- React + Next.js frontend
- Job status + clip preview + approval UI
- Voice DNA profile builder
- One-click publish to connected platforms

**Phase 3 — Multi-tenant (weeks 11-20)**
- Organization accounts + per-user voice profiles
- White-label domain support
- Team publishing approval workflows
- Analytics dashboard per account

### Multi-tenant Architecture

```python
class TenantContext(BaseModel):
    tenant_id: str
    voice_profile: VoiceDNA
    connected_platforms: list[PlatformCredential]
    feature_flags: dict
    usage_quota: UsageQuota

def run_copywriter(clip: ScoredClip, tenant: TenantContext) -> PlatformCopy:
    return run_agent(
        system=build_system_prompt(tenant.voice_profile),
        user_message=build_copy_request(clip, tenant),
        output_schema=PlatformCopy,
    )
```

All DB queries are tenant-scoped. Render artifacts: `s3://{bucket}/{tenant_id}/output/...`

---

## 8. 30-DAY BUILD PLAN

### Week 1 — Core Pipeline as Autonomous System

**Goal:** The existing manual pipeline runs without you typing commands.

| Days | Task | Key Libraries |
|------|------|--------------|
| 1-2 | Data layer: Prisma schema + SQLite | `prisma`, `@prisma/client` |
| 3-4 | Job queue: BullMQ + Redis + chokidar file watcher | `bullmq`, `ioredis`, `chokidar` |
| 5-6 | Claude API integration: port clip-selection + copywriter skills to typed TS functions | `@anthropic-ai/sdk`, `zod` |
| 7 | Integration test: drop a video → watch pipeline run end-to-end | — |

**Day 7 success criteria:** Drop a 30-minute video in `input/`. Clips emerge in `output/clips/` with scores + captions — no manual commands.

---

### Week 2 — AI Agents + Intelligence Layer

**Goal:** Scored, copy-ready clip packages with minimal human input.

| Days | Task | Key Libraries |
|------|------|--------------|
| 8-9 | Deterministic signal stack (density, patterns, sentiment) | Built-in regex, no deps |
| 10-11 | Trend monitor (Perplexity API, 12h Redis cache) | `axios`, `ioredis` |
| 12-13 | Content Strategy Agent (analytics → posting schedule JSON) | `@anthropic-ai/sdk`, `zod` |
| 14 | Growth Agent + platform-specific hashtag system | `axios` |

---

### Week 3 — Automation + Publishing

**Goal:** Content goes from raw video to scheduled posts automatically.

| Days | Task | Key Libraries |
|------|------|--------------|
| 15-16 | Distribution layer: Late API client with retry + Fastify webhook receiver | `axios`, `fastify` |
| 17-18 | Analytics feedback loop: daily BullMQ cron pulls post performance → re-weights scorer | BullMQ cron |
| 19-20 | Fastify server: `/ingest`, `/jobs`, `/clips/pending`, `/clips/:id/approve` | `fastify`, `@fastify/jwt` |
| 21 | CLI approval interface: `npx ts-node src/cli/approve.ts` | `inquirer`, `chalk` |

---

### Week 4 — Business Integration + Monetization Prep

**Goal:** Consulting lead gen active. Music outreach running. SaaS foundation laid.

| Days | Task | Key Libraries |
|------|------|--------------|
| 22-23 | Consulting pipeline: CaseStudyGenerator + LeadMagnetGenerator + Notion CRM | `axios` (Notion API) |
| 24-25 | Music outreach: Google Places → venue DB + VenueOutreachAgent | `@googlemaps/google-maps-services-js` |
| 26-27 | SaaS foundation: multi-tenant Prisma schema + API key auth + Stripe | `@fastify/jwt`, `stripe` |
| 28-30 | Dashboard v0: Next.js + Clerk auth + job status + clip review | Next.js, Clerk |

**Deploy targets:** Railway (Node.js API + BullMQ workers + Redis) + Vercel (Next.js dashboard)

---

## Critical Technical Decisions

### 1. WhisperX vs AssemblyAI

| | WhisperX | AssemblyAI |
|--|---------|-----------|
| Cost | Free | $0.00025/sec |
| GPU | Required | No |
| Speed | 10x real-time (M3 Max) | API latency |
| Word timestamps | Yes | Yes |

**Decision:** WhisperX local for all personal use. AssemblyAI fallback for cloud/SaaS deployments.

### 2. Vector DB for content deduplication

```typescript
// Use chromadb JS client or call embeddings + store in Prisma + pgvector (prod)
// On new clip: check cosine similarity against last 90 days of posts
// Threshold > 0.92 → flag as near-duplicate before publishing

import { ChromaClient } from 'chromadb';
// or for prod: store embeddings as Float32Array in Postgres with pgvector
```

Model: `text-embedding-3-small` via `@anthropic-ai/sdk` or OpenAI SDK (1536 dims, $0.00002/1K tokens)

### 3. Remotion render at scale

- **Local V2:** `ProcessPoolExecutor` max 2 workers (avoid OOM)
- **Cloud/SaaS:** `@remotion/lambda` — renders on AWS Lambda, ~$0.003/minute of video. This is the unlock for productization.

### 4. Database evolution path

- **Weeks 1-8:** SQLite (zero ops, sufficient for single tenant)
- **Week 9+ with clients:** Postgres on Railway ($5/mo)
- Prisma works with both — just change `provider` in `schema.prisma`, run `prisma migrate deploy`

### 5. Music content crop mode

Current face-center crop cuts off guitar hands. Fix: add `upper_body` mode to `CropCalculator` that centers on midpoint between face and wrist keypoints (already available from `PoseEstimator`). ~50-line change to `tools/clip_extractor/crop/crop_calculator.py`.

---

## Architecture Summary

```
                         ┌─────────────────┐
  Video drop / webhook   │  INGESTION      │  Watchdog + FastAPI
  ─────────────────────→ │  LAYER          │
                         └────────┬────────┘
                                  │ ARQ Job: transcribe
                         ┌────────▼────────┐
  WhisperX / AssemblyAI  │  PROCESSING     │  Python workers
                         │  LAYER          │  (GPU-accelerated)
                         └────────┬────────┘
                                  │ SRT + words.json
                         ┌────────▼────────┐
  VADER + regex +        │  INTELLIGENCE   │  Deterministic prescreen
  Claude API             │  LAYER          │  → top 20 → LLM scoring
                         └────────┬────────┘
                                  │ scored clip_definitions.json
                         ┌────────▼────────┐  ← USER APPROVAL
  clip_extractor +       │  TRANSFORM      │  Python + Node/Remotion
  Remotion + KIE.ai      │  LAYER          │  + Claude API (edit + copy)
                         └────────┬────────┘
                                  │ final .mp4 + copy + thumbnail
                         ┌────────▼────────┐
  Late API + retry       │  DISTRIBUTION   │  Scheduled via ARQ cron
  + analytics pull       │  LAYER          │
                         └────────┬────────┘
                                  │ post_ids + performance metrics
                         ┌────────▼────────┐
  SQLite → Postgres      │  DATA LAYER     │  ChromaDB + feedback loop
  + ChromaDB             │                 │  → re-weights scorer
                         └─────────────────┘
                                  │
                    ┌─────────────┼──────────────┐
                    ▼             ▼               ▼
             CONSULTING       MUSIC          SAAS API
             lead gen         outreach       (FastAPI)
             case studies      venue EPKs    → Dashboard
             Notion CRM        bookings      → Multi-tenant
```
