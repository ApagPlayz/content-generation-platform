# Content Generation Platform

A local-first dashboard that runs autonomous AI agents to research, script, render, and
publish short-form video — sports highlights, true-crime narration, and history explainers
— to YouTube, TikTok, and Instagram, on a schedule, with a cost ledger and a legal/compliance
gate in front of every publish.

## The problem it solves

Making short-form video content at any real volume is a pipeline: find a source clip or
story, write a script, generate or source visuals, assemble and caption the video, check it
isn't going to get the channel demonetized or sued, then post it to the right platform at the
right time — repeated daily, per format, per channel. Doing that by hand doesn't scale, and
naively automating it produces exactly the kind of repetitive, unreviewed "AI slop" that gets
channels flagged. This project is an attempt to automate the whole pipeline while keeping a
human in the loop where it actually matters (legal risk, budget, what gets published) and
out of the loop everywhere else.

Each content format is its own semi-autonomous **Agent** running inside a **Factory** (a
reusable content-format config). An agent's run walks a fixed pipeline of stages — source
material → script → visuals/footage → assembly/render → compliance gate → publish — with
every stage persisted as a `Job` row so failures are visible and retryable rather than silent.

## What's actually notable here

- **A real compliance/legal gate, not a content filter.** `src/lib/compliance/` runs claim
  extraction, source corroboration, a defamation lint (hedges guilt language for anyone not
  convicted, blocks realistic AI likeness of real people), case-selection screening, and a
  visual/narrative "variation" check aimed squarely at YouTube's 2025 "inauthentic content"
  policy (mass-produced, templated videos can get a whole channel demonetized). Every gated
  script produces a `ComplianceReport` decision — `pass`, `route_to_review`, or `block` —
  persisted for auditability, not just logged to a console.
- **A cost ledger with a budget cap that's actually enforced.** Every paid call (LLM, TTS,
  image/video generation) writes a `CostLedger` row. `src/lib/pipeline/budget.ts` sums a
  run's spend before each stage and throws a `BudgetExceededError` once it reaches the
  agent's configured cap — the codebase's own comments note this used to be a UI promise
  with no runtime code behind it, and call out the fix by issue number (#26).
- **A five-agent adversarial CI review, not a green checkmark.** Every pull request in this
  repo is torn apart by five independent Claude reviewers running in parallel, each briefed
  with a different lens, followed by a verification pass that discards anything
  unsubstantiated — see `.github/workflows/claude-audit.yml`. A separate stack-agnostic
  `repo-tests.yml` runs plain install/lint/test/build CI with no agent involved.
- **An autonomous improvement loop.** Scheduled GitHub Actions agents (`claude-scout.yml`,
  `claude-builder.yml`, `claude-retro.yml`) research the codebase, file scoped proposals,
  build one at a time against a review-queue cap, and revise their own process weekly based
  on what actually got merged vs. rejected. Every agent still only ever opens issues/PRs —
  nothing pushes straight to `main`. See `docs/AUTONOMOUS-LOOP.md`.
- **In-process job/scheduler system, no external queue.** There's no Redis or worker
  cluster: `src/lib/scheduler.ts` + `/api/scheduler/tick` compute due schedules and drive
  agent runs directly against SQLite via Prisma, with stuck-run recovery
  (`src/lib/recovery.ts`) and per-stage retry/backoff (`src/lib/retry.ts`).
- **641 passing tests across 35 files** (`npm test`, Vitest) covering the pipeline stages,
  compliance gate, scheduler timing math, budget enforcement, and platform integrations.

## Architecture

- **App:** Next.js 15 (App Router), React 18, Tailwind. UI in `src/app/`, API routes under
  `src/app/api/**/route.ts`.
- **Data:** Prisma ORM over SQLite (`prisma/schema.prisma`) — `Factory`, `Agent`,
  `AgentRun`, `Video`, `Asset`, `Job`, `Post`, `Metric`, `CostLedger`,
  `ComplianceReport`, `PlatformAuth`, and more.
- **Pipeline/orchestration:** `src/lib/orchestrator.ts` (sports) and
  `src/lib/truecrime/orchestrator.ts` / `src/lib/history/orchestrator.ts` (other factories)
  run each stage of a video's life in-process, writing a `Job` row per stage for the
  dashboard's queue view and for retries.
- **Rendering:** ffmpeg by default; optionally Remotion (`video/`, `src/lib/render/remotion.ts`)
  for animated karaoke-style captions and proper 9:16 framing, with automatic fallback to
  ffmpeg on error.
- **Compliance:** `src/lib/compliance/` — the gate described above, shared across factories
  via a `ComplianceProfile` (true crime is strictest; history/business relaxes only the
  crime-specific heuristics).
- **Publishing:** `src/lib/tools/publish.ts`, `src/lib/youtube.ts`, `src/lib/tiktok.ts` —
  OAuth-based publishing to YouTube and TikTok, with quota tracking.
- **CI/automation:** `.github/workflows/` — plain CI (`repo-tests.yml`) plus a set of
  Claude-driven agents (Scout/Builder/Auditor/Retro/@mention) documented in
  `docs/AUTONOMOUS-LOOP.md` and `docs/DASHBOARD-CONTRACT.md`.

## Setup / running it locally

Requirements: Node 20+ (developed on Node 26), npm.

```bash
git clone https://github.com/ApagPlayz/content-generation-platform.git
cd content-generation-platform
npm install
npm run prisma:generate
npm run prisma:push      # creates the SQLite DB at prisma/prisma/dev.db
npm run dev              # http://localhost:3000
```

Run the test suite with `npm test` (Vitest; 641 tests, no external services required).

Everything above runs with **no API keys** — the pipeline degrades to keyless defaults
(template scripts, public-domain Wikimedia images, a fallback TTS voice). Optional `.env.local`
keys unlock better versions of each stage: `ANTHROPIC_API_KEY`/`CLAUDE_API_KEY` for an
AI-written script, `PEXELS_API_KEY`/`PIXABAY_API_KEY` for stock footage,
`OPENAI_API_KEY`/`STABILITY_API_KEY`/`REPLICATE_API_TOKEN` for AI still-image generation,
and YouTube/TikTok OAuth credentials to enable real publishing.

`npm run go` (`scripts/dev-start.sh`) is a macOS convenience launcher used in local
development — it also boots a Docker-based local TTS voice and manages a PM2-kept-alive
production build. It isn't required; `npm run dev` is the portable path.

## AI-assisted authorship

This repository was built through an extensive, iterative collaboration with Claude (Anthropic).
Of the commits on `main`, a majority carry a `Co-Authored-By: Claude` trailer (as of this
writing, 59 of 160) — those trailers are left in the commit history rather than hidden. The
autonomous CI agents described above (Scout/Builder/Auditor/Retro) are themselves Claude
agents, running as part of the project's normal development loop rather than as a one-off
generation step. The design decisions, architecture, and product direction are the owner's;
Claude was used heavily for implementation, research, testing, and code review.

## License

MIT — see [LICENSE](LICENSE).
