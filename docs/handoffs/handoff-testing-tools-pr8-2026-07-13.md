# Handoff — PR #7 merged, testing-tools research done, PR #8 (autonomous loop v2) awaiting owner (2026-07-13)

_Date: 2026-07-13 · Working tree currently on branch `claude/autonomous-loop-v2` (= PR #8, OPEN) · Repo: https://github.com/ApagPlayz/content-generation-platform (PRIVATE, `gh` authed as ApagPlayz)_

> Self-contained handoff. Assume you (the next session) start cold with zero memory.
> Owner is **non-technical**, on **Claude Max 20×** (tokens NOT a constraint — delegate
> aggressively to subagents/workflows, prefer thorough approaches). Report in plain
> bullets + an `Updates/` file (owner-update skill); end any file-changing reply with the
> 3-bullet micro-recap (Changed / Next / Your turn). Owner gets frustrated when they
> can't SEE results — always verify visually (extract video frames with ffmpeg, Playwright
> screenshots) and show concretely, never claim quality without frame evidence.
> **NEW RULE in CLAUDE.md: read `LEARNINGS.md` before starting work** (mistakes log,
> maintained via weekly retro, changes only through owner-merged PRs — see
> `docs/AUTONOMOUS-LOOP.md`).

## Goal

Ongoing mission: a local AI short-form video platform (Next.js 15 + Prisma/SQLite at
localhost:3000) whose output looks like monetizable faceless-channel content. This
session's arc: (1) merged the video-quality overhaul (PR #7) on the owner's "merge it";
(2) owner rejected the Claude-in-Chrome extension → ran a deep-research pass (100 agents,
live-verified) ranking verification-loop tooling; (3) a separate session/agent opened
PR #8 (autonomous improvement loop v2) which is now checked out locally and awaiting the
owner's decision.

## Done so far (this session, exact paths)

1. **PR #7 MERGED to main** (2026-07-12): video-quality fixes (reliable Remotion karaoke
   captions, relevant archive footage with junk-still rejection + Chromium-safe JPEG
   re-encode, letterboxed framing, caption spacing, footage ON by default; tests 31→47).
   Branch `fix/video-quality-captions-archive` deleted. Then committed to main (`8c54f60`):
   `Updates/2026-07-12-video-quality-round.md` + `docs/handoffs/handoff-f11-realapp-videoquality-2026-07-12.md`
   (that older handoff has full detail on F11 factory, Pake desktop app, PM2 launcher,
   quality-round specifics — read it if working on any of those).
2. **Owner REJECTED the Claude-in-Chrome extension** ("i dont like the chrome extension")
   — never re-suggest it. Memory updated: `memory/screen-verification-options.md` + index.
3. **Deep research: verification-loop tooling ranked** (100 agents, every claim
   live-verified 2026-07-12). Owner report: `Updates/2026-07-12-testing-tools-research.md`
   (UNCOMMITTED — untracked). Ranked results:
   - **#1 Playwright MCP (already installed)** — keep as primary driver; practitioner
     consensus; microsoft/playwright-mcp v0.0.78, deterministic accessibility snapshots.
   - **#2 Chrome DevTools MCP (Google)** — the ONE worthwhile add: full console history,
     network waterfall with request/response bodies, perf traces/CWV, heap snapshots,
     Lighthouse. Free, no creds: `claude mcp add chrome-devtools npx chrome-devtools-mcp@latest`.
     "Playwright drives, DevTools debugs." **Recommended to owner — AWAITING their yes.**
   - Peekaboo = niche complement (whole-desktop macOS; could verify MP4 playback) — not now.
   - Built-in computer-use MCP = NOT suitable (browsers view-only per Anthropic docs).
   - PinchTab/browser-use/agent-browser/checklist-skills = skip (unproven or never open the app).
   - Caveat: Playwright MCP tool schemas ≈13.7k context tokens/session; DevTools ≈18k.

## Done elsewhere (NOT this session — appeared 2026-07-13)

4. **PR #8 OPEN: "Autonomous improvement loop v2 — audit, measure, learn"**, branch
   `claude/autonomous-loop-v2` (commit `715e786`), currently CHECKED OUT locally.
   +637 lines, adds: 5 GitHub Actions (`.github/workflows/claude-{audit,builder,mention,retro,scout}.yml`
   + `loop-metrics.yml`), `LEARNINGS.md`, `LOOP-DASHBOARD.md`, `docs/AUTONOMOUS-LOOP.md`,
   `metrics/loop-metrics.json`, `scripts/loop-metrics.mjs`, and a CLAUDE.md section
   ("read LEARNINGS.md first"). This session did NOT review it. Owner has NOT decided.

## Current state

- **Working:** main has all merged quality fixes; app runs under PM2 (`content-engine`)
  in prod mode at :3000 (`npm run go` — staleness-stamp auto-rebuild). Desktop app
  (Pake) functional. 47/47 tests green on main as of merge.
- **Local checkout is on PR #8's branch `claude/autonomous-loop-v2`**, clean except
  untracked: `Updates/2026-07-12-testing-tools-research.md` (commit to main when
  convenient) and `sports-example.mp4` (21MB old sample — NEVER commit).
- Nothing broken or mid-edit. Firecrawl MCP still out of credits (WebSearch fallback fine).
- Known video-quality gaps queued for round 3: (a) one archive reel repeats across all
  6 beats — needs per-video multi-item diversity; (b) some stills very dark — needs
  luma check/normalization; (c) captions occasionally start with bare punctuation token.

## Next steps (ordered)

1. **Owner decision: Chrome DevTools MCP** — on "add the DevTools tool":
   `claude mcp add chrome-devtools npx chrome-devtools-mcp@latest`, then verify by
   driving localhost:3000 and reading console/network. It's a config change — needs the
   explicit yes first (recommendation already made).
2. **Owner decision: PR #8** — review it first (this session never did): check the 5
   GitHub Actions for cost/permissions implications (they run Claude in CI), then plain-
   bullet summary to owner → merge/close per their call. After any merge:
   `git checkout main && git pull --ff-only`.
3. **Commit `Updates/2026-07-12-testing-tools-research.md`** to main (piggyback on the
   next main commit or do it standalone).
4. **Quality round 3 (when owner says go):** archive-item diversity per beat (search once
   per video, distribute distinct identifiers; relax collections beyond prelinger when
   few hits), brightness/luma gate on extracted stills, fix punctuation-only leading
   caption tokens (`src/lib/truecrime/captions.ts`).
5. **Free keys (owner):** Pexels + Pixabay into `.env.local` → `useStockFootage: true`
   in configs/seeds → stock B-roll tier + full mood bank (`npm run moodbank:populate`).
6. Backlog: reject 3 older pre-fix F11 videos in inbox (safe), ElevenLabs MCP (needs
   explicit yes), F12 horror factory, YouTube OAuth creds for publish.

## Key files & context

- **Run app:** `npm run go` (prod+PM2, staleness-stamp auto-rebuild; `DEV=1 npm run go`
  for dev mode). PM2: `pm2 logs content-engine`. Tests `npm test` · types
  `npx tsc --noEmit` · build `npm run build`.
- **Read `LEARNINGS.md` first** (new CLAUDE.md rule, from PR #8's branch).
- **Trigger an F11 video:** `curl -X POST http://localhost:3000/api/agents/cmrfuvzlx0002t10vvwwliey6/run`,
  poll `/api/videos` (~3 min). Quality baseline video: `cmrhyip7e00038b2wf8wom9bo`
  (Panic of 1907). Inspect frames: `localPath` from Video row
  (`sqlite3 prisma/prisma/dev.db`), `ffmpeg -ss N -i final.mp4 -frames:v 1 f.jpg`, Read the jpg.
- **DB:** `prisma/prisma/dev.db` (Prisma path quirk). `RENDER_ENGINE=remotion` in
  `.env.local` (gitignored); ffmpeg fallback has no libass locally → captions rely on Remotion.
- **Compliance invariant:** stage order discover→script→footage→visuals→compliance→tts→
  captions→assemble — NEVER reorder; imagery lands on `ctx.script.visuals` in `visuals`.
- **PostToolUse hook** (`.claude/hooks/check-on-edit.sh`) runs tsc per edit — create
  types before consumers; ignore its eslint duplicate-config warnings.
- **Research provenance:** testing-tools deep-research run `wf_1b3ae1c3-7e5`
  (journal under `~/.claude/projects/-Users-...-Content-Generation-Platform/216ef5a6-*/subagents/workflows/`).
  Memory `screen-verification-options.md` holds the durable ranking + "never re-suggest
  Chrome extension" flag.
- Playwright MCP screenshots land in repo root/`.playwright-mcp/`; owner can't see them —
  `open <file>` pops Preview on their screen.

## Open questions / decisions pending (owner)

1. **Add Chrome DevTools MCP?** ("add the DevTools tool" / "no thanks") — only pending
   recommendation from the research.
2. **PR #8 (autonomous loop v2)** — merge, change, or close? Needs a review + plain
   summary first.
3. **Free Pexels/Pixabay keys** — unlocks stock footage tier + full mood bank.
4. **Quality round 3 go-ahead** (variety + brightness + caption-token nit).
5. Reject the 3 older pre-fix F11 videos in the inbox? (safe to reject).
6. Firecrawl credit top-up (out since 2026-07-10) · ElevenLabs MCP yes/no.
