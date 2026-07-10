# Handoff — Phase 2 footage ladder + quality boosts (BUILT, verified, uncommitted)

_Date: 2026-07-08 · Branch: `feat/phase2-footage-ladder` (branched off `feat/factory-pipelines-compliance`)_

> Self-contained handoff. Assume you (the next session) start cold with zero memory of the
> prior conversation. Read this fully before acting. Owner is **non-technical**, on the
> **Claude Max 20× plan** (token cost is NOT a constraint — delegate aggressively, prefer
> thorough/multi-agent approaches). Report to the owner in plain bullets + an `Updates/` file
> (see "Reporting conventions" below). End any reply that changes files with the 3-bullet
> micro-recap (Changed / Next / Your turn).

---

## Goal

Take the already-delivered **content sourcing strategy** (the "Phase 2 real-footage upgrade"
+ two quality boosts) and **actually build it into the codebase**. The owner said, verbatim,
to "send a fleet of agents to research and plan implementation plans and then execute
everything that was found in the research." That has now been **done and verified**. The
remaining work is the owner's go/no-go decisions (merge? which genre to polish? which free
keys to add) and any polish they request.

Bigger picture: this repo is a local AI short-form video platform (Next.js 15 + Prisma/SQLite)
with two pipelines — **F9 Sports** (`src/lib/orchestrator.ts`) and **F10 True Crime**
(`src/lib/truecrime/orchestrator.ts`). Phase 2 is mostly an F10 upgrade (per-beat footage),
plus an isolated F9 sports "transformation layer."

---

## Done so far (concrete, with exact paths)

### 0. Report re-published as a browser Artifact (earlier in session)
The owner couldn't open the PDF, so the sourcing report was re-published as a theme-aware web
page. Source HTML: `<scratchpad>/sourcing-report.html`. Artifact URL:
`https://claude.ai/code/artifact/e8c455ba-8da9-4d12-95ae-f6f89904c24d`. (PDF still exists at
`Updates/2026-07-06-sourcing-strategy-and-upgrades-report.pdf`.)

### 1. Two workflows were run (research → plan, then execute)
- **Research+plan workflow** (`wf_a27d08cd-e9b`): 6 codebase-mapping agents + 9 planning
  agents + 1 synthesizer → produced a conflict-aware build order. Artifacts saved:
  `<scratchpad>/phase2-plans.json` (the 10 per-workstream plans) and
  `<scratchpad>/phase2-build-order.json` (the synthesized 4-stage build order). The script is
  at `.../workflows/scripts/phase2-research-and-plan-wf_a27d08cd-e9b.js`.
- **Execution workflow** (`wf_6f3f8aa2-33e`): 4 sequential stages with a `tsc` gate after each.
  All 4 gates passed (`tsc` exit 0 each; final `npm run build` exit 0). Script at
  `.../workflows/scripts/phase2-execute-footage-ladder-wf_6f3f8aa2-33e.js`.

`<scratchpad>` = `/private/tmp/claude-501/-Users-alessiopagliarulo-Documents-Claude-Projects-Content-Generation-Platform/475bb0f1-6c20-4122-a2d3-dc326587cc97/scratchpad`

### 2. Code that was BUILT (all on branch `feat/phase2-footage-ladder`)

**New files (13 + 4 tier adapters in `footage/`):**
- `src/lib/truecrime/stockClipCache.ts` — Prisma cache helper for the new `StockClip` model.
- `src/lib/truecrime/stockFootage.ts` — Pexels→Pixabay vertical clip fetch (key-gated; no-ops without keys).
- `src/lib/truecrime/archiveFootage.ts` — archive.org public-domain fetch (**no key**); maps license conservatively to `unknown` (→ review), `depictsRealPerson` defaults true.
- `src/lib/truecrime/aiStill.ts` — pluggable image provider: `openai` / `stability` (key-gated) / `local` keyless ffmpeg gradient fallback. Hard "no identifiable faces / symbolic only" negative constraint.
- `src/lib/truecrime/kenBurns.ts` — ffmpeg zoompan pan/zoom of a still → 1080×1920 mp4 clip.
- `src/lib/truecrime/moodBank.ts` — reads `assets/mood-bank/manifest.json`, picks N clips by category.
- `src/lib/truecrime/footage.ts` — **the resolver**: walks the tier ladder per beat.
- `src/lib/truecrime/footage/{aiStill,stock,archiveOrg,moodBank}.ts` — thin tier adapters that call the helpers above.
- `src/lib/truecrime/styleVariation.ts` — per-video visual-style / editorial-angle rotation.
- `src/lib/truecrime/timeline.ts` — builds a seconds-based `TimelineSegment[]` from beats (duration math verified, no off-by-one).
- `src/lib/compliance/visualSignature.ts` — per-asset "reused footage" fingerprint (dedupes; skips AI stills).
- `src/lib/tools/transform.ts` + `src/lib/tools/leaguePolicy.ts` — F9 sports transformation layer + league policy (favor NBA, flag NFL/UFC).
- `scripts/populate-mood-bank.mjs` — downloads curated CC0/PD atmospheric clips into `assets/mood-bank/`.
- `assets/mood-bank/` — `manifest.json`, `clips/.gitkeep`, `README.md` (clips/* is gitignored).

**Modified files (~20):** `prisma/schema.prisma` (adds `StockClip` model, `@@unique([source,externalId])`),
`src/lib/truecrime/types.ts` (pre-declared ALL optional F10 config keys + `F10Context.beatFootage` +
`VisualAsset.beatIndex` + `F10_STAGES` gains `'footage'` after `'script'` + `TimelineSegment`),
`scripts/seed-truecrime.mjs` (all new config keys, features OFF by default),
`src/lib/truecrime/orchestrator.ts` (new `footage` stage wired after `script`, before `compliance`;
`visuals` stage now a Wikimedia backfill floor),
`src/lib/truecrime/visuals.ts`, `src/lib/truecrime/assemble.ts` (per-beat stitching + even-split fallback),
`src/lib/truecrime/script.ts` (optional AI writer behind `useAiScript`),
`src/lib/settings.ts`, `src/lib/render/remotion.ts`, `video/{Root,TrueCrime,types}.tsx/ts`,
`src/lib/compliance/{gate,types,variation}.ts` (new visual-repetition axis folded into `checkVariation()`),
F9: `src/lib/orchestrator.ts`, `src/lib/tools/{types,source,script,assemble}.ts`, `scripts/seed-sports.mjs`,
`.env.local` (commented key placeholders), `.gitignore`, `package.json` (adds `moodbank:populate` script).

### 3. Reviewed + verified (this is important — it's all been checked)
- **Independent `npx tsc --noEmit` → clean. `npm run build` → passes.**
- **compliance-reviewer agent: verdict SAFE.** Gate still runs after all footage is merged
  into `ctx.script.visuals`; `block` halts before render/publish; AI stills can't be a real
  person's likeness; archive.org fails closed; AI-written scripts still go through claims/
  defamation checks. It flagged ONE minor hardening item (now FIXED, see below).
- **code-reviewer agent: keyless/flags-off default path traced end-to-end, does NOT throw**
  (degrades to the even-split slideshow). It found 5 "when you turn it on" findings.
- **5 fixes applied by me** (all type-check clean via the PostToolUse hook):
  1. **HIGH** — seeded `footageLadder` used names (`wikimedia`,`ai`) that didn't match tier
     keys (`ai_still`,`stock`,`archive`,`moodbank`), so the AI-still tier was dead. Fixed the
     seed (`scripts/seed-truecrime.mjs`) **and** added a `TIER_ALIASES` map in
     `src/lib/truecrime/footage.ts` so legacy/synonym names still resolve.
  2. **MEDIUM** — a partial timeline render + `-shortest` mux could truncate narration.
     `src/lib/truecrime/assemble.ts`: if not all timeline segments render, discard the partial
     result and fall back to the full-length even-split slideshow.
  3. **Compliance** — `src/lib/truecrime/moodBank.ts` `toVisualAsset()` now honors the
     manifest's `depictsRealPerson`/`aiGenerated` fields instead of hard-coding `false`.
  4. **LOW** — `src/lib/compliance/visualSignature.ts` now skips AI stills (they're generated
     fresh per render) so distinct videos aren't falsely flagged as "reused footage."
  5. **LOW** — `assemble.ts` `renderVideoClip` crop hardened to `crop='min(iw,ih*9/16)':ih`
     (defensive; that video-clip path is currently dead code since tiers poster-frame to stills).
- **Runtime render test (general-purpose agent, ffmpeg-only, no TTS/Docker): ALL PASS.**
  (A) default slideshow → 6.0s; (B) per-beat timeline → 6.0s; (C) one beat's clip missing →
  falls back to full 6.0s (NOT truncated — proves fix #2); resolver with `footageEnabled:false`
  → empty no-op, no throw. Record: `Updates/2026-07-06-true-crime-render-path-verified.md`.

### 4. Owner deliverables written
- `Updates/2026-07-06-phase2-footage-ladder-built.md` — the plain-language owner summary.
- (also the render-verified note above.)

---

## Current state

- **Everything works, type-checks, production-builds, and renders at runtime.** All new
  features are **OFF by default** (seeded config) and the app behaves exactly as before until a
  flag is flipped. Nothing auto-publishes.
- **Branch:** `feat/phase2-footage-ladder`. Working tree: **48 files changed, ~4220 insertions,
  67 deletions** (new files are `git add -N` intent-to-add, hence they show as ` A` in
  `git status` — NOT yet committed).
- **NOT committed.** Per the owner's global rule ("commit only when asked"), nothing has been
  committed. The owner was asked "merge or keep separate?" and "commit?" — **awaiting their answer.**
- **`sports-example.mp4`** is intentionally left UNTRACKED (it's a loose 4 MB sample from before
  this session; it briefly got staged and was deliberately un-staged so it won't be committed).
- Dev server: not confirmed running this session. Check with
  `curl -s -o /dev/null -w "%{http_code}" localhost:3000`.

---

## Next steps (ordered, specific)

1. **Get the owner's two decisions** (these gate everything): (a) **merge** the branch into
   `feat/factory-pipelines-compliance` (or main), or keep it separate to trial? (b) **commit**
   the branch now? If yes to commit, stage the code (NOT `sports-example.mp4`, NOT the loose
   `Updates/*.pdf`/`.md` unless wanted) and write a clear commit message; do NOT push unless asked.
2. **If they want to see it live:** flip the free, keyless features in the True Crime factory
   config — `footageEnabled: true` and `useArchiveFootage: true` (edit
   `scripts/seed-truecrime.mjs` then `node scripts/seed-truecrime.mjs`, or edit the Factory row
   in Prisma Studio). Then run a True Crime video and watch the pipeline. NOTE: a full run needs
   the **TTS stage** — Kokoro local (Docker) must be up, or whatever TTS the repo uses; if TTS
   isn't available the run fails at the `tts` stage (unrelated to Phase 2 code).
3. **To unlock stock footage:** owner adds free **PEXELS_API_KEY** + **PIXABAY_API_KEY** to
   `.env.local` (placeholders already there), then set `useStockFootage: true`.
4. **To unlock AI stills / AI script:** add OPENAI or STABILITY key (stills) and/or ANTHROPIC/
   CLAUDE key (writer); set `imageProvider` to `'ai'`/`'wikimedia+ai'` and/or `useAiScript: true`.
5. **Polish pass (owner picks genre):** True Crime (bigger visual upgrade) or Sports (the
   transformation layer). Likely first real-world tuning: the `CUE_QUERY_MAP` in `footage.ts`
   (maps beat mood-cues → safe stock/archive search queries) and the mood-bank population.
6. **Optional deeper verification:** the runtime test only covered the **ffmpeg** render path.
   The **Remotion** path (`RENDER_ENGINE=remotion`, animated captions) was type/build-checked
   but not runtime-exercised — worth a live check if the owner uses Remotion.

---

## Key files & context

### Run / test (from CLAUDE.md)
- Start/open app: `npm run go` (idempotent). Restart clean:
  `lsof -ti:3000 | xargs kill 2>/dev/null; npm run go`.
- Typecheck: `npx tsc --noEmit`. Build: `npm run build`. Lint: `npm run lint`.
- DB: SQLite via Prisma; **real file lives at `prisma/prisma/dev.db`** (Prisma quirk). After
  schema edits: `npm run prisma:push` (+ `npm run prisma:generate`). Re-seed:
  `node scripts/seed-sports.mjs && node scripts/seed-truecrime.mjs`.
- **PostToolUse hook** (`.claude/hooks/check-on-edit.sh`) runs `tsc` after every Edit and
  **blocks** the edit if it introduces a type error — so if you add a symbol you must use it in
  the same/next edit. This is expected, not a bug.

### The build order / conflict rules (why it was safe to parallelize)
- The real shared-file bottleneck was `src/lib/truecrime/types.ts` (9 workstreams add config
  keys). Strategy used: **Stage 1 pre-declared ALL optional config keys + context fields + the
  `'footage'` stage + `TimelineSegment` in one pass**, plus seeded them and added `.env.local`
  placeholders, so Stage 2+ agents only created their OWN new files. Full detail:
  `<scratchpad>/phase2-build-order.json`, per-workstream specs: `<scratchpad>/phase2-plans.json`.
- Stage order was: **1** schema+types foundation → **2** provider tools (6 parallel, new files
  only) → **3** resolver-ladder wiring + anti-repetition variation → **4** assemble/render.
- Compliance ordering that MUST be preserved: the `footage` stage runs **after `script`,
  before `compliance`**, and must set `ctx.script.visuals` so every sourced asset is linted.
  `block` → status `rejected` (skips tts/render/publish); `route_to_review` → status `review`
  (never auto-publishes). Don't reorder these.

### Compliance engine (respect it — `compliance-reviewer` agent audits changes here)
`src/lib/compliance/{gate,visualLint,variation,visualSignature,claims,corroboration,
defamationLint,legalStatus,sources,caseSelection,types}.ts`. `visualLint` hard-blocks
`aiGenerated && depictsRealPerson`. archive.org `unknown` license → review severity, never
fail-open. AI stills must never be tagged `depictsRealPerson:false` dishonestly.

### Reporting conventions (owner is non-technical)
- After meaningful work: plain-bullet chat reply (What I did / What I recommend next) + a file
  in `Updates/YYYY-MM-DD-*.md`. Use the `owner-update` skill; template in `Updates/README.md`.
- After ANY file change: end with the 3-bullet micro-recap (Changed / Next / Your turn).
- Delegate aggressively (Max 20× plan): Haiku=trivial, Sonnet=moderate, Opus=heavy reasoning;
  run independent agents in parallel; you stay the orchestrator (agents return conclusions).

---

## Open questions / decisions pending (waiting on the owner)

1. **Merge or keep separate?** Branch `feat/phase2-footage-ladder` vs the parent branch.
2. **Commit now?** Nothing is committed yet (per the "commit only when asked" rule).
3. **Which genre to polish first** — True Crime or Sports?
4. **Which free keys will they add** (Pexels/Pixabay = free; OpenAI/Stability/Anthropic = paid)?
   None are required to run — all features degrade gracefully without keys.
5. Behavioral note to reconfirm with owner: with footage ON, some archive.org clips route to
   **review** (not auto-publish) by design because their copyright status isn't guaranteed —
   that is the safe/intended behavior, not a bug.
