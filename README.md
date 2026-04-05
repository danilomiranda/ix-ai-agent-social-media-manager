<p align="center">
  <img src="assets/ix-logo.png" alt="IX AI" width="120" />
</p>

<h1 align="center">IX AI Agent Social Media Manager</h1>

<p align="center">
  <strong>Create, edit, and publish content across 13+ platforms. All from your coding agent.<br/>Thumbnails. Video editing. Carousels. Distribution. 16 skills. One repo.</strong>
</p>

---

## What's Inside

### Distribution (3 skills)
- **late-social-media** -- Post to 13+ platforms via Zernio (Twitter, LinkedIn, Instagram, YouTube, TikTok, Threads, and more)
- **short-form-posting** -- Optimized for Shorts, Reels, and TikTok with unique captions per platform
- **youtube-content-package** -- Complete YouTube packages (title, description, tags, timestamps, thumbnail)

### Visual Creation (3 skills)
- **thumbnail-creator** -- YouTube thumbnails via KIE AI with face compositing and bold text
- **carousel-generator** -- Multi-slide image carousels for LinkedIn and Instagram
- **document-carousel** -- Educational documents as HTML, converted to PDF, extracted as page images

### Video Pipeline (8 skills)
- **clip-extractor** -- Face-tracking reframe (16:9 to 9:16) with MediaPipe and Kalman smoothing
- **clip-selection** -- Analyze transcripts, score moments, select best clips
- **edit** -- Entry point router that detects format and dispatches
- **video-editing** -- Shared component library and editing rules
- **short-form-editing** -- Polished short-form edits (<90s) with Remotion
- **long-form-editing** -- Long-form video editing (5+ min) with Remotion
- **extracting-transcripts** -- Word-level transcription for cutting and captions
- **visual-overlay-creation** -- Create custom illustrations for video overlays

### Utility (2 skills)
- **video-upload-helper** -- Compress and upload video files
- **content-analytics** -- Track post performance across platforms

---

## Tools Included

| Tool | What It Does |
|------|-------------|
| **Remotion** | React video compositions. 68 components, 22 compositions, 60 illustrations. Frame-perfect at 30fps. |
| **Clip Extractor** | Python face-tracking pipeline. MediaPipe detection, Kalman smoothing, 4 layout modes. |

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/danilomiranda/ix-ai-agent-social-media-manager.git
cd ix-ai-agent-social-media-manager
```

### 2. Use Node 22

```bash
nvm use 22
```

### 3. Install dependencies

```bash
# Node.js (Remotion + V2 pipeline)
npm install

# Prisma DB setup
npm run db:migrate

# Python (clip extractor + transcription)
# Requires Python 3.11+
pip install -r tools/clip_extractor/requirements.txt
```

The clip extractor requires these Python packages:
- **mediapipe** -- Face detection (BlazeFace)
- **opencv-contrib-python** -- Video frame processing (cv2)
- **numpy** -- Array operations
- **filterpy** -- Kalman filter for temporal smoothing
- **pyyaml** -- Config parsing
- **rapidfuzz** -- Fuzzy text matching

> **Troubleshooting:** If clip extraction produces a static center crop instead of face-tracking, verify that `opencv-contrib-python` installed correctly: `python -c "import cv2; print(cv2.__version__)"`.

### 4. Set API keys

Create a `.env` file in the project root:

```bash
# Social media publishing
ZERNIO_API_KEY=your-zernio-api-key        # Required: zernio.com (free to start)
ZERNIO_PROFILE_ID=your-profile-id         # Required: from your Zernio dashboard
KIE_API_KEY=your-kie-api-key              # Optional: kie.ai (thumbnails/carousels)

# V2 pipeline
ANTHROPIC_API_KEY=your-anthropic-api-key  # Required: console.anthropic.com
DATABASE_URL=file:./dev.db
REDIS_URL=redis://localhost:6379
PORT=3001
```

### 5. Start Redis (for V2 pipeline)

```bash
docker compose up -d
```

### 6. Open in Claude Code

```bash
claude
```

Claude Code reads the skills automatically. Say "post to LinkedIn" or "create a thumbnail" and it works.

---

## V2 Pipeline (Autonomous Mode)

Run the pipeline headlessly without typing commands:

```bash
# Terminal 1 — background workers
npm run dev:worker

# Terminal 2 — API server + file watcher
npm run dev:api
```

Drop a `.mp4` into `input/` and the pipeline starts automatically:
```
input/your-video.mp4
  → transcription (WhisperX)
  → clip selection (Claude API)
  → face-track reframe (Python CV)
  → Remotion edit
  → publish (Late API)
```

API endpoints:
- `POST /ingest` — trigger pipeline for a video path or URL
- `GET /jobs/:id` — check job status
- `GET /clips/pending` — review scored clips awaiting approval
- `POST /clips/:id/approve` — approve and trigger edit + publish

---

## Session Commands

Once you're in Claude Code:
- **`/continue`** -- Resume a session. Loads context, checks system readiness, reviews recent work, suggests what to do next.
- **`/done`** -- Close a session. Validates system, syncs docs, generates a report, commits and pushes.

---

## Quick Start Examples

**Post to social media:**
> "Post this to Twitter and LinkedIn: Just shipped a new feature that lets AI agents manage your entire content pipeline."

**Create a thumbnail:**
> "Create a YouTube thumbnail for my video about AI agents running businesses"

**Extract clips from a recording:**
> "Extract the best 3 clips from recording.mp4 and reframe them for TikTok"

**Full YouTube package:**
> "Create a full YouTube package for my latest video -- title, description, tags, timestamps, and thumbnail"

See `examples/` for more detailed walkthroughs.

---

## Requirements

- **Claude Code** (or any Claude-powered coding agent)
- **Node.js 22+** (for Remotion + V2 pipeline)
- **Python 3.11+** with pip (for clip extractor and transcription)
- **FFmpeg** (for video processing -- [download](https://ffmpeg.org/download.html) or `brew install ffmpeg`)
- **Docker** (for Redis — required for V2 autonomous pipeline)
- **Zernio API key** ([zernio.com](https://zernio.com) -- free to start) for social media posting
- **Anthropic API key** ([console.anthropic.com](https://console.anthropic.com)) for AI agents
- **KIE API key** ([kie.ai](https://kie.ai)) for AI image generation (optional)

---

Built by [Danilo Miranda](https://github.com/danilomiranda)
