# Session: V2 Architecture Plan

**Date:** 2026-04-04
**Type:** Documentation / Architecture

## What Was Done
- Analyzed current repository architecture in depth (skills system, Python CV pipeline, Remotion component library, Late API integration)
- Identified key scaling gaps: no queue, no DB, no autonomous execution, no business integrations
- Designed full V2 system architecture covering 6 layers: Ingestion → Processing → Intelligence → Transformation → Distribution → Data
- Defined 6 AI agents with typed schemas: Content Strategist, Viral Clip Detector, Video Editor, Copywriter, Growth Agent, Outreach Agent
- Documented the hybrid viral scoring approach (deterministic signal stack → LLM top-20 candidates, ~70% API cost reduction)
- Designed the complete Video → Shorts pipeline with stage-by-stage implementation detail
- Designed ARQ + Redis job queue with pipeline chaining and cron scheduling
- Documented business integration layer for consulting (lead gen, case studies, Notion CRM) and music (venue outreach, EPK, upper_body crop mode)
- Designed SaaS evolution path: API → Dashboard → Multi-tenant
- Produced a 30-day developer-level build plan with specific libraries and milestones
- Created `docs/` directory and saved the full plan to `docs/v2-architecture.md`

## Content Produced
- `docs/v2-architecture.md` — complete V2 architecture document (~600 lines)

## Issues Found & Fixed
- None — this was a planning/documentation session

## Documents Updated
- `docs/v2-architecture.md` (created)
- `sessions/2026-04-04-v2-architecture-plan.md` (this file)

## What's Next
- **Week 1 priority:** Build the data layer (`core/models.py` with SQLModel) and job queue (ARQ + Redis)
- **First integration test:** File watcher → transcription → clip selection running without manual commands
- **Quick win:** Port the existing `clip-selection` skill to a typed Python function calling Claude API directly
- **Music content fix:** Add `upper_body` crop mode to `tools/clip_extractor/crop/crop_calculator.py`

## Commit
- Pending
