# Handoff — Autonomous improvement loop: 5 PRs built, ALL MERGED to main (2026-07-10)

_Date: 2026-07-10 · Branch: `main` (now current and complete) · Repo: https://github.com/ApagPlayz/content-generation-platform (PRIVATE)_

> Self-contained handoff. Assume you (the next session) start cold with zero memory of the
> prior conversation. Owner is **non-technical**, on the **Claude Max 20× plan** (token cost
> is NOT a constraint — delegate aggressively to subagents, prefer thorough approaches).
> Report in plain bullets + an `Updates/` file; end any file-changing reply with the 3-bullet
> micro-recap (Changed / Next / Your turn). GitHub CLI `gh` is authenticated as **ApagPlayz**.

---

## Goal

The owner asked for a ~1-hour autonomous improvement loop: (1) improve the platform and ship
the improvements as GitHub PRs for approval, (2) research NEW content-factory types based on
what others monetize with automated/faceless content, (3) list recommended tools/MCPs and
anything the owner must set up personally. **That loop ran to completion**, and the owner then
said "merge them all" — **all 5 PRs are merged**. The session's remaining thread is choosing
and building **content factory #3**.

## Done so far (all COMPLETE and pushed to GitHub)

### The big state change: `main` is now the real platform
Discovery at loop start: `main` only had the initial scaffold commit — ALL real work lived on
local-only branches. Fixed via PR #1. `main` (local + origin) now contains everything:
both factories, compliance engine, YouTube publish, Kokoro TTS + karaoke captions, Remotion
render, and the Phase 2 per-beat footage ladder. Local checkout is on `main`, clean except
the intentionally-untracked `sports-example.mp4` (old 21 MB sample — never commit it).

### The 5 PRs (all MERGED 2026-07-10, branches deleted)
1. **PR #1 — Bring all factory work to main** — merged `feat/phase2-footage-ladder`
   (22 commits incl. the freshly committed Phase 2 work `ec7e5b7`) into `main`.
2. **PR #2 — First automated tests** — vitest + `npm test`; 31 passing tests in
   `src/lib/truecrime/timeline.test.ts` (buildBeatTimeline/toCumulativeFrames invariants) and
   `src/lib/truecrime/footage.test.ts` (cueToQuery, namesRealSubject, TIER_ALIASES — the only
   source change was exporting TIER_ALIASES).
3. **PR #3 — Review inbox explains itself** — `src/app/page.tsx` InboxTab now fetches each
   pending video's latest ComplianceReport + `footage-map` Asset; `src/components/inbox-card.tsx`
   shows "Review reasons" (gate decision, % facts verified, defamation/variation chips),
   a footage-provenance line ("3× archive · 2× AI still…"), case-name chip for F10, and the
   F10 badge fix (TYPE_META deduped). Graceful when a video has no report (older/sports).
4. **PR #4 — Smarter fallback footage** — mood-bank categories expanded 5→11 (courtroom,
   prison, forest, highway-at-night, still-water, interrogation) aligned with CUE_QUERY_MAP;
   lanczos+hqdn3d upscaling for tiny archive clips in `assemble.ts` + `moodBank.ts`;
   `populate-mood-bank.mjs` prefers higher-res files; still-extraction seek varies by beat.
5. **PR #5 — Honest settings** — wired `moodBankEnabled` (skips moodbank tier when false),
   `archiveMaxClips` (caps archive fetch), `stockProviders` (provider order in
   `stockFootage.ts`); DROPPED dead keys `imageProvider` (superseded by `aiStillProvider`),
   `footageSource`, `moodBankMaxPerVideo` from `types.ts` + `scripts/seed-truecrime.mjs`.

### Research delivered (full text in `Updates/2026-07-10-autonomous-improvement-loop.md`)
**New-factory candidates, ranked:** ① History/business-story mini-docs (F11 candidate —
~90% reuse of F10: same beat scripts, footage ladder, TTS; business-story CPM $10–25; needs a
topic-discovery source e.g. Wikipedia "on this day", a lighter compliance profile for pre-1950
topics, optional Remotion map/date scenes). ② Horror/paranormal stories (F12 — same stack,
fiction ⇒ far less defamation risk; RPM $6–12; needs story generator — do NOT scrape r/nosleep,
authors keep copyright — plus darker mood bank, TikTok AIGC label). ③ Finance/AI-news recaps
(F13 — highest ceiling, RPM $10–25 + affiliates; needs market/news ingest, Remotion chart
scenes, "educational not advice" disclaimer gate). Skip: quiz shorts, lofi/AI music,
motivational. Policy context: YouTube's July-2025 "inauthentic content" policy (channel-wide
enforcement of mass-produced video) and TikTok's AIGC-label rules (~73% reach loss unlabeled)
make our compliance/variation engine the key moat. **Owner's stated pick: not made yet.**
Recommendation on record: History/business mini-docs first.

**MCP/tool recommendations (nothing installed — owner must say yes):** ① ElevenLabs MCP
(official; `claude mcp add elevenlabs -- uvx elevenlabs-mcp`; reuses existing ELEVENLABS_API_KEY;
top pick). ② community ffmpeg video MCP (e.g. misbahsy/video-audio-mcp — verify freshness).
③ YouTube analytics MCP (ZubeidHendricks/youtube-mcp-server — only once actively publishing).
Rejected: TikTok/IG posting MCPs (APIs too restrictive), Postiz (needs self-hosting), extra
image-gen MCPs (aiStill.ts already covers), trend scrapers (Firecrawl covers).

### Owner deliverable
`Updates/2026-07-10-autonomous-improvement-loop.md` — committed to main (`3e95ed9`).

## Current state

- **Working:** everything. `main` = complete platform; tests green (31); tsc + prod build
  verified on every merged PR. All Phase 2 features still OFF by default in seeds.
- **Nothing broken, nothing mid-edit.** All agent worktrees removed, temp branches deleted.
- **⚠️ Firecrawl MCP is OUT OF CREDITS** — every firecrawl search 402s. Research agents fell
  back to built-in WebSearch. Owner must top up.
- Dev server status unknown; start with `npm run go`.
- DB may need `npm run prisma:push` + re-seed if the merged schema (StockClip model) hasn't
  been pushed locally yet, and `node scripts/seed-truecrime.mjs` to pick up the PR #5 config
  changes (dropped/renamed keys).

## Next steps (ordered)

1. **Owner decision: factory #3.** If they say "build it" / agree with the recommendation,
   build the **History/business-story mini-doc factory (F11)** by cloning the F10 pipeline:
   new topic-discovery module (replace court-records case discovery with curated historical
   events / Wikipedia), lighter compliance profile (keep claims-corroboration; relax
   living-person defamation gate for pre-1950 subjects), reuse footage ladder + TTS + assemble
   as-is. Use the research/plan/execute multi-workflow pattern that built Phase 2 (see
   `docs/handoffs/handoff-phase2-footage-ladder-2026-07-08.md` for how that was structured).
2. **Housekeeping after merge:** run `npm run prisma:push` and re-seed
   (`node scripts/seed-sports.mjs && node scripts/seed-truecrime.mjs`), then `npm run go` and
   spot-check the upgraded Review inbox renders (PR #3) with existing DB rows.
3. **If owner wants footage live:** flip `footageEnabled: true` + `useArchiveFootage: true`
   in the True Crime factory config; optionally run `npm run moodbank:populate` (free,
   keyless) to fill the 6 new mood categories.
4. **If owner adds keys:** PEXELS_API_KEY / PIXABAY_API_KEY in `.env.local` → set
   `useStockFootage: true`. ElevenLabs MCP install only after an explicit yes.
5. Still open from before: Remotion render path (`RENDER_ENGINE=remotion`) has never been
   runtime-exercised — a smoke script was proposed (improvement-scan proposal #5) but not built.

## Key files & context

- **Run app:** `npm run go` (idempotent). Restart: `lsof -ti:3000 | xargs kill 2>/dev/null; npm run go`.
  Tests: `npm test` (vitest). Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
- **Pipelines:** F9 sports `src/lib/orchestrator.ts` + `src/lib/tools/*`; F10 true crime
  `src/lib/truecrime/orchestrator.ts` (+ footage ladder `src/lib/truecrime/footage.ts`,
  tiers in `footage/*`, `timeline.ts`, `assemble.ts`); compliance `src/lib/compliance/*`.
- **Compliance invariant:** `footage` stage runs after `script`, before `compliance`; every
  sourced asset must land in `ctx.script.visuals` so the gate lints it. Never reorder.
- **PostToolUse hook** (`.claude/hooks/check-on-edit.sh`) runs tsc after every edit and blocks
  type-error edits. In worktrees its lint half can false-warn about duplicate eslintrc — ignore;
  tsc is the real gate.
- **Worktree gotcha (bit 3 of 4 agents):** `isolation: worktree` agents got worktrees pinned to
  the initial scaffold commit, NOT the current branch. Instruct any worktree agent to verify
  `git log --oneline -1` shows the expected tip and otherwise
  `git checkout -B <branch> origin/main` before working.
- **Merging pattern used:** small PRs squash-merged into the feature branch first, then the big
  PR merge-committed into main — keeps history readable.
- DB file really lives at `prisma/prisma/dev.db` (Prisma quirk). `gh` authed as ApagPlayz;
  repo is PRIVATE (owner sees 404 when logged out — this confused them once already).
- Owner struggles with GitHub UI + screenshots; macOS Screen Recording permission for the
  terminal is NOT granted (`screencapture` fails). Prefer doing GitHub actions via `gh` for them.

## Open questions / decisions pending (waiting on the owner)

1. **Which factory #3 to build** — recommendation: History/business mini-docs (F11). Horror
   (F12) as fast-follow. Awaiting their pick / "build it".
2. **Firecrawl credit top-up** — needed before the next research-heavy session.
3. **ElevenLabs MCP install** — yes/no (config change; needs explicit yes).
4. **Free stock keys** — Pexels + Pixabay into `.env.local` (placeholders exist), unlocks the
   stock tier.
5. Reconfirm behavior expectation: with footage ON, some archive.org clips route to **review**
   (not auto-publish) by design — intended safety, not a bug.
