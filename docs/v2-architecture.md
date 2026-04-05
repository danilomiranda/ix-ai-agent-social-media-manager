# V2 System Architecture — IX AI Orchestration Platform

> Date: 2026-04-04
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

### Design Philosophy

**Monorepo, modular services.** Not microservices — you're one person. The system should be deployable as a single process on a single machine, but factored so each domain can be extracted into a service when you need to scale. The decision boundary is: "does this need to run while I'm asleep?" If yes, it needs to be a background worker.

**Layered architecture:**

```
┌──────────────────────────────────────────────────────────┐
│                    INGESTION LAYER                        │
│  Watch folders / Webhooks / RSS / Manual drop             │
├──────────────────────────────────────────────────────────┤
│                   PROCESSING LAYER                        │
│  Transcription · Face tracking · Clip extraction          │
├──────────────────────────────────────────────────────────┤
│              CONTENT INTELLIGENCE LAYER                   │
│  Viral scoring · Hook analysis · Topic clustering         │
├──────────────────────────────────────────────────────────┤
│               TRANSFORMATION LAYER                        │
│  Remotion edit · Caption gen · Thumbnail · Carousel       │
├──────────────────────────────────────────────────────────┤
│                 DISTRIBUTION LAYER                        │
│  Late API · Direct APIs · Scheduling · Queue              │
├──────────────────────────────────────────────────────────┤
│                     DATA LAYER                            │
│  SQLite → Postgres · Vector DB · Analytics · Feedback     │
└──────────────────────────────────────────────────────────┘
```

### Target Folder Structure

```
ix-platform/
├── core/                           # Shared contracts + utils
│   ├── schemas/                    # Pydantic models (Job, Clip, Post, Lead)
│   ├── config.py                   # Env-based config (pydantic-settings)
│   └── db.py                       # SQLite/Postgres ORM (SQLModel)
│
├── ingestion/                      # Layer 1: Event sources
│   ├── watcher.py                  # Watchdog: folder monitor (video drops)
│   ├── webhook.py                  # FastAPI: YouTube/Late/CRM webhooks
│   └── rss.py                      # Podcast RSS poller
│
├── processing/                     # Layer 2: Heavy compute
│   ├── transcriber.py              # WhisperX → word-level SRT + JSON
│   ├── clip_selector.py            # Claude API call → scored clip JSON
│   └── reframer/                   # Existing tools/clip_extractor/ (unchanged)
│
├── intelligence/                   # Layer 3: AI analysis
│   ├── viral_scorer.py             # Heuristic + LLM hybrid scorer
│   ├── hook_extractor.py           # First-3-second hook quality
│   ├── topic_tagger.py             # Embedding-based topic clustering
│   └── trend_monitor.py            # Twitter/TikTok trend polling
│
├── transformation/                 # Layer 4: Content generation
│   ├── remotion_runner.py          # Programmatic Remotion render orchestration
│   ├── copywriter.py               # Platform-specific post copy (Claude API)
│   ├── thumbnail_gen.py            # KIE.ai + face composite orchestration
│   └── carousel_gen.py             # Document carousel HTML → PDF → PNG
│
├── distribution/                   # Layer 5: Publishing
│   ├── publisher.py                # Late API client with retry + queue
│   ├── scheduler.py                # Cron-based post timing
│   └── platform_adapters/          # Per-platform formatting rules
│       ├── youtube.py
│       ├── tiktok.py
│       ├── linkedin.py
│       └── instagram.py
│
├── data/                           # Layer 6: Persistence
│   ├── migrations/                 # Alembic
│   ├── models.py                   # SQLModel ORM models
│   ├── vector_store.py             # ChromaDB/Qdrant client
│   └── analytics.py               # Performance aggregation queries
│
├── agents/                         # Agent definitions (Claude API)
│   ├── content_strategist.py
│   ├── viral_detector.py
│   ├── copywriter.py
│   ├── growth_agent.py
│   └── outreach_agent.py
│
├── business/                       # Business-layer integrations
│   ├── consulting/
│   │   ├── case_study_gen.py
│   │   ├── lead_magnet_gen.py
│   │   └── crm_sync.py             # HubSpot/Notion CRM
│   └── music/
│       ├── venue_outreach.py
│       └── show_packager.py
│
├── api/                            # REST API (future SaaS surface)
│   ├── main.py                     # FastAPI app
│   ├── routers/
│   └── auth.py                     # API key / JWT
│
├── worker/                         # Background workers
│   ├── pipeline_worker.py          # Main processing loop (ARQ/Celery)
│   └── feedback_worker.py          # Analytics → scoring feedback loop
│
├── .claude/                        # Existing skill system (keep as-is)
├── remotion/                       # Existing Remotion (keep as-is)
├── tools/                          # Existing Python tools (keep as-is)
│
├── docker-compose.yml
├── pyproject.toml                  # Python deps (uv)
└── package.json                    # Node deps (Remotion)
```

### Database Schema (Core Tables)

```sql
-- Source content
CREATE TABLE sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,           -- 'youtube_video' | 'local_file' | 'podcast'
  url TEXT,
  file_path TEXT,
  title TEXT,
  duration_sec FLOAT,
  initiative TEXT NOT NULL,     -- 'social_engine' | 'dark_channel' | 'consulting' | 'music'
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Processing jobs
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES sources(id),
  type TEXT NOT NULL,           -- 'transcribe' | 'select' | 'reframe' | 'edit' | 'publish'
  status TEXT DEFAULT 'queued', -- 'queued' | 'running' | 'done' | 'failed'
  input JSONB,
  output JSONB,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Extracted clips
CREATE TABLE clips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID REFERENCES sources(id),
  title TEXT,
  start_sec FLOAT,
  end_sec FLOAT,
  hook_strength INT,
  value_delivery INT,
  clarity INT,
  shareability INT,
  completeness INT,
  total_score INT,
  category TEXT,
  file_path TEXT,               -- reframed 9:16 output
  edited_path TEXT,             -- Remotion render output
  transcript_excerpt TEXT,
  embedding vector(1536),       -- pgvector for semantic search
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Published posts
CREATE TABLE posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id UUID REFERENCES clips(id),
  platform TEXT,
  late_post_id TEXT,
  title TEXT,
  caption TEXT,
  hashtags TEXT[],
  status TEXT,
  published_at TIMESTAMPTZ,
  views INT DEFAULT 0,
  likes INT DEFAULT 0,
  shares INT DEFAULT 0,
  comments INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads (consulting + music)
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT,                  -- 'youtube_comment' | 'linkedin_dm' | 'email'
  initiative TEXT,              -- 'consulting' | 'music'
  name TEXT,
  contact TEXT,
  content TEXT,
  score INT,
  status TEXT DEFAULT 'new',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Monolith vs Microservices Recommendation

**Stay monolith, factor into workers.** The bottleneck is compute (transcription, face tracking, rendering), not request volume. A single Python process with async workers (ARQ backed by Redis) handles parallelism without the ops overhead of containers per service. Extract only what genuinely needs to run independently:

- `processing/reframer` → already a Python package, stays local
- `remotion` render → Node subprocess, stays local
- API layer → can be extracted to a separate FastAPI process if you open it to clients

---

## 3. AI AGENT DESIGN

Use the **Claude API with tool use** for all agents. Each agent is a Python function that constructs a system prompt, assembles context, calls Claude, and returns a typed Pydantic object. No LangChain, no agent framework overhead.

### Agent Pattern (shared)

```python
# core/agent_base.py
import anthropic
from pydantic import BaseModel
from typing import TypeVar, Type

T = TypeVar("T", bound=BaseModel)

client = anthropic.Anthropic()

def run_agent(
    system: str,
    user_message: str,
    output_schema: Type[T],
    model: str = "claude-opus-4-6",
    tools: list | None = None,
) -> T:
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        system=system,
        messages=[{"role": "user", "content": user_message}],
        tools=tools or [],
    )
    return output_schema.model_validate_json(response.content[0].text)
```

---

### Agent 1: Content Strategist Agent

**Purpose:** Given a long-form video transcript + channel analytics, decide what content to produce, for which platforms, and when.

**Input:**
```python
class ContentStrategyInput(BaseModel):
    transcript_summary: str          # 500-word LLM summary of video
    channel_analytics: dict          # Top posts, avg engagement, follower segments
    trending_topics: list[str]       # From trend_monitor.py
    content_backlog: list[str]       # Pending clips not yet posted
    voice_dna: str                   # Full Voice DNA profile
```

**Output:**
```python
class ContentPlan(BaseModel):
    priority_clips: list[str]        # Clip IDs to process this week, ranked
    platform_matrix: dict[str, list] # {"tiktok": [clip_1, clip_3], "linkedin": [clip_2]}
    posting_schedule: list[PostSlot] # Datetime + platform + clip_id
    content_gaps: list[str]          # Topics missing from recent output
    recommended_hooks: list[str]     # 3 hook variations per top clip
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
```python
class ViralDetectorInput(BaseModel):
    transcript_segments: list[TranscriptSegment]
    source_category: str              # "podcast" | "tutorial" | "performance" | "case_study"
    target_duration_range: tuple[int, int]  # (45, 90) seconds
    previous_scores: list[dict] | None      # Historical clip performance for calibration
```

**Output:**
```python
class ScoredClip(BaseModel):
    start_words: str       # Verbatim anchor, 5-8 words
    end_words: str
    start_sec_estimate: float
    end_sec_estimate: float
    hook_strength: int     # 0-20
    value_delivery: int
    clarity: int
    shareability: int
    completeness: int
    total_score: int
    category: str
    hook_pattern: str      # "bold_claim" | "stat" | "problem_statement" | "reframe"
    best_improvement: str
```

**Deterministic pre-filters (run before LLM call):**
```python
def prescreen_segments(segments: list) -> list:
    filtered = []
    for seg in segments:
        if re.match(r'^(so|um|okay|anyway|like i was)', seg.text.lower()):
            continue
        if not (40 <= seg.duration <= 95):
            continue
        word_count = len(seg.text.split())
        if word_count / seg.duration < 1.5:  # < 1.5 words/sec = too sparse
            continue
        filtered.append(seg)
    return filtered
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
```python
class EditRequest(BaseModel):
    clip_path: str
    transcript_srt: str
    score: ScoredClip
    format: str               # "short-form-pipeline" | "short-form-standalone" | "long-form"
    style_variant: str        # From remotion/playbook/styles/
    cta_text: str | None
    source_video_title: str | None
```

**Output:** Generated `.tsx` file content + `.ts` word data file content (returned as strings, written to disk by caller).

**Memory/context:** Last 3 composition files as few-shot examples + illustration library index.

---

### Agent 4: Copywriting Agent

**Purpose:** Generate platform-specific post copy that matches Voice DNA.

**Input:**
```python
class CopyRequest(BaseModel):
    clip_score: ScoredClip
    transcript_excerpt: str
    platform: str                # "twitter" | "linkedin" | "instagram" | "tiktok" | "youtube"
    voice_dna: str
    post_history: list[str]      # Last 10 posts on this platform (dedup check)
```

**Output:**
```python
class PlatformCopy(BaseModel):
    platform: str
    title: str | None            # YouTube only
    body: str
    hashtags: list[str]
    cta: str
    char_count: int
    hook_type: str
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
```python
class GrowthPackage(BaseModel):
    trending_hashtags: list[str]
    trending_audio: list[str]        # TikTok/Reels audio trends
    competitor_hooks: list[str]      # What's working in adjacent accounts
    content_angle_variations: list[str]
    optimal_post_times: dict         # {"tiktok": "18:00-20:00 EST", ...}
```

---

### Agent 6: Outreach Agent

**Purpose:** Generate personalized outreach for consulting leads and venue bookings.

**Input:**
```python
class OutreachTarget(BaseModel):
    target_type: str          # "consulting_lead" | "venue" | "collaborator"
    target_name: str
    target_description: str
    context: str
    offer: str
    your_recent_content: list[str]
```

**Output:**
```python
class OutreachMessage(BaseModel):
    subject: str
    body: str
    follow_up_day3: str
    follow_up_day7: str
    personalization_signals: list[str]
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
```python
def information_density_score(segment: Segment) -> float:
    words_per_sec = len(segment.text.split()) / segment.duration
    unique_noun_ratio = len(set(extract_nouns(segment.text))) / len(segment.text.split())
    return (words_per_sec * 0.6) + (unique_noun_ratio * 40)
```

**Signal 2 — Pattern Matching (deterministic)**
```python
VIRAL_PATTERNS = {
    "stat_hook":    r'\b\d+[%xX]?\b.*\b(in|within|after)\b.*\b(days?|weeks?|months?)\b',
    "bold_claim":   r'^(The (truth|reality|problem|issue)|Most people|Nobody tells you|Stop)',
    "reframe":      r'\b(actually|wrong|myth|lie|mistake)\b',
    "result_reveal":r'\b(made|earned|generated|reached|grew)\b.*\b\$?\d+[kKmM]?\b',
    "framework":    r'\b(step \d|rule \d|\d\s+things|formula|system|framework)\b',
}
```

**Signal 3 — Sentiment Volatility (deterministic)**
```python
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
analyzer = SentimentIntensityAnalyzer()

def sentiment_volatility(sentences: list[str]) -> float:
    scores = [analyzer.polarity_scores(s)['compound'] for s in sentences]
    return float(np.std(scores))  # High std = emotional range = engaging
```

**LLM call strategy:** Run deterministic signals first. Only send **top 20 segments** (by combined score) to Claude for semantic scoring. Cuts API cost ~70% on a 60-minute video.

**Where LLM is non-negotiable:**
- Hook semantic quality
- Value delivery (is this genuinely useful?)
- Shareability (would target audience send this to a friend?)
- Cross-reference check (does clip assume prior context viewers won't have?)

---

## 5. AUTOMATION + ORCHESTRATION

### Queue Architecture (ARQ + Redis)

```python
# worker/pipeline_worker.py
from arq import cron
from arq.connections import RedisSettings

async def transcribe(ctx, job: dict): ...
async def clip_select(ctx, job: dict): ...
async def reframe(ctx, job: dict): ...
async def edit_composition(ctx, job: dict): ...
async def publish(ctx, job: dict): ...

class WorkerSettings:
    functions = [transcribe, clip_select, reframe, edit_composition, publish]
    redis_settings = RedisSettings(host="localhost", port=6379)
    max_jobs = 3        # Don't overwhelm local GPU
    job_timeout = 3600  # 1hr max per job

    cron_jobs = [
        cron(trend_monitor_refresh, hour={9, 21}),       # Twice daily
        cron(analytics_feedback_loop, hour=3),           # 3am daily
        cron(outreach_queue_processor, hour={10, 15}),   # Business hours
    ]
```

**Pipeline chaining (fan-out):**
```python
async def transcribe(ctx, job: dict):
    result = run_whisperx(job["source_path"])
    await ctx["redis"].enqueue_job("clip_select", {
        "transcript": result.srt_path,
        "source_video": job["source_path"],
        "parent_job_id": job["id"],
    })
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

| Python | Node/TypeScript |
|--------|----------------|
| Video processing (CV, FFmpeg) | Remotion compositions (.tsx) |
| Transcription (WhisperX) | SRT → word data (.ts) |
| All AI agent calls (Claude API) | Remotion rendering (subprocess) |
| Pipeline orchestration (ARQ) | — |
| API server (FastAPI) | — |
| CRM/outreach integrations | — |
| Analytics + DB | — |

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
```python
class CaseStudyInput(BaseModel):
    client_description: str
    problem_before: str
    solution_implemented: str
    results: dict               # Metrics: time saved, revenue, leads
    client_quote: str | None

class CaseStudy(BaseModel):
    linkedin_post: str          # Authority post (problem → system → result)
    short_form_script: str      # 60s short
    lead_magnet_title: str
    email_sequence: list[str]   # 3-email nurture from lead magnet download
```

**CRM sync (Notion):**
```python
def log_lead(name: str, source_post_id: str, company: str | None = None):
    requests.post(f"{NOTION_API}/pages", json={
        "parent": {"database_id": NOTION_LEADS_DB_ID},
        "properties": {
            "Name": {"title": [{"text": {"content": name}}]},
            "Source": {"rich_text": [{"text": {"content": source_post_id}}]},
            "Status": {"select": {"name": "New"}},
            "Date": {"date": {"start": datetime.now().isoformat()}},
        }
    }, headers={"Authorization": f"Bearer {NOTION_API_KEY}",
                "Notion-Version": "2022-06-28"})
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

**Note on crop mode:** Current clip extractor is face-center. For guitar performance content, a custom `upper_body` crop mode is needed that centers between face position and wrist keypoints (available from existing `PoseEstimator`). This is a ~50-line change to `crop_calculator.py`.

**Venue outreach:**
```python
class VenueTarget(BaseModel):
    venue_name: str
    venue_type: str           # "bar" | "theater" | "festival" | "restaurant"
    city: str
    typical_acts: list[str]   # Scraped from Instagram
    booking_contact: str | None
    booking_email: str | None

class ShowPackage(BaseModel):
    epk_pdf_path: str
    pitch_email: str
    follow_up_email: str
    social_proof_links: list[str]
```

Data source for venue targets: Google Places API (Places API) filtered by category + city.

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
| 1-2 | Data layer: SQLModel + Alembic + SQLite | `sqlmodel`, `alembic`, `aiosqlite` |
| 3-4 | Job queue: ARQ + Redis + file watcher | `arq`, `redis`, `watchdog` |
| 5-6 | Claude API integration: port clip-selection + copywriter skills to typed Python functions | `anthropic`, `pydantic` |
| 7 | Integration test: drop a video → watch pipeline run end-to-end | — |

**Day 7 success criteria:** Drop a 30-minute video in `input/`. Clips emerge in `output/clips/` with scores + captions — no manual commands.

---

### Week 2 — AI Agents + Intelligence Layer

**Goal:** Scored, copy-ready clip packages with minimal human input.

| Days | Task | Key Libraries |
|------|------|--------------|
| 8-9 | Deterministic signal stack (density, patterns, VADER sentiment) | `vaderSentiment`, `spacy` |
| 10-11 | Trend monitor (Perplexity API, 12h Redis cache) | `httpx`, `diskcache` |
| 12-13 | Content Strategy Agent (analytics → posting schedule JSON) | `anthropic` |
| 14 | Growth Agent + platform-specific hashtag system | `httpx` |

---

### Week 3 — Automation + Publishing

**Goal:** Content goes from raw video to scheduled posts automatically.

| Days | Task | Key Libraries |
|------|------|--------------|
| 15-16 | Distribution layer: Late API client with retry + webhook receiver | `tenacity`, `fastapi` |
| 17-18 | Analytics feedback loop: daily cron pulls post performance → re-weights scorer | `arq` cron |
| 19-20 | FastAPI server: `/ingest`, `/jobs`, `/clips/pending`, `/clips/{id}/approve` | `fastapi`, `uvicorn` |
| 21 | CLI approval interface: `python -m ix approve` | `rich`, `typer` |

---

### Week 4 — Business Integration + Monetization Prep

**Goal:** Consulting lead gen active. Music outreach running. SaaS foundation laid.

| Days | Task | Key Libraries |
|------|------|--------------|
| 22-23 | Consulting pipeline: CaseStudyGenerator + LeadMagnetGenerator + Notion CRM | `notion-client` |
| 24-25 | Music outreach: Google Places → venue DB + VenueOutreachAgent | `googlemaps` |
| 26-27 | SaaS foundation: multi-tenant schema + API key auth + Stripe | `python-jose`, `stripe` |
| 28-30 | Dashboard v0: Next.js + Clerk auth + job status + clip review | Next.js, Clerk |

**Deploy targets:** Railway (Python API + workers) + Vercel (Next.js dashboard)

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

```python
import chromadb

# On new clip: check cosine similarity against last 90 days of posts
# Threshold > 0.92 → flag as near-duplicate before publishing
```

Model: `text-embedding-3-small` (1536 dims, $0.00002/1K tokens)

### 3. Remotion render at scale

- **Local V2:** `ProcessPoolExecutor` max 2 workers (avoid OOM)
- **Cloud/SaaS:** `@remotion/lambda` — renders on AWS Lambda, ~$0.003/minute of video. This is the unlock for productization.

### 4. Database evolution path

- **Weeks 1-8:** SQLite (zero ops, sufficient for single tenant)
- **Week 9+ with clients:** Postgres on Railway ($5/mo)
- SQLModel works with both — no ORM change needed

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
