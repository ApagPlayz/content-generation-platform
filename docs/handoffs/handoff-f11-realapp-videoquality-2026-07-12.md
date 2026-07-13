# Handoff — F11 factory built + real Mac app + video-quality overhaul (2026-07-12)

_Date: 2026-07-12 · Branch: `fix/video-quality-captions-archive` (PR #7 OPEN, awaiting owner's "merge it") · Repo: https://github.com/ApagPlayz/content-generation-platform (PRIVATE, `gh` authed as ApagPlayz)_

> Self-contained handoff. Assume you (the next session) start cold with zero memory.
> Owner is **non-technical**, on **Claude Max 20×** (tokens NOT a constraint — delegate
> aggressively to subagents/workflows, prefer thorough approaches). Report in plain
> bullets + an `Updates/` file (owner-update skill); end any file-changing reply with the
> 3-bullet micro-recap (Changed / Next / Your turn). Owner gets frustrated when they
> can't SEE results — always verify visually (extract video frames with ffmpeg, Playwright
> screenshots) and show/tell concretely, never claim quality without frame evidence.

## Goal

This session's arc: the owner said "set up Chrome, make it a real app, build factory #3
entirely, multiple agents" — then "the video looks like shit" → a video-quality overhaul.
All three builds are DONE and verified; the quality overhaul round 2 is DONE and sitting
in **PR #7 awaiting the owner's merge decision**. The larger mission: a local AI
short-form video platform whose output actually looks like monetizable faceless-channel
content.

## Done so far (all verified, exact paths)

### 1. Factory #3 = F11 History & Business Mini-Docs (MERGED to main via PR #6)
- Built by a staged agent workflow (foundations → parallel build → gates), pattern in
  `docs/handoffs/handoff-phase2-footage-ladder-2026-07-08.md`.
- **Compliance parameterized:** `src/lib/compliance/profile.ts` — `ComplianceProfile`,
  `TRUE_CRIME_PROFILE` (default, F10 bit-identical), `HISTORY_PROFILE` (F11). Gate
  signature: `gateVideoScript(script, {videoId, generatedAt}, profile?)`.
  `ComplianceReport.factoryType` column added (default "F10"); variation corpus is now
  factory-scoped (fixed cross-factory "too similar" contamination).
- **F11 pipeline:** `src/lib/history/{types,topicDiscovery,script,orchestrator}.ts` —
  clones F10's stage shape (discover→script→footage→visuals→compliance→tts→captions→assemble,
  ORDER IS INVARIANT), reuses F10's footage/visuals/tts/captions/assemble by import.
  Dispatch: `src/lib/run.ts` `type==='F11'` → `executeHistoryRun`.
- **Registration:** UI badges (amber) in `src/app/page.tsx`, `src/components/{agent-card,inbox-card,winners-view}.tsx`,
  `src/app/factories/new/page.tsx`, `src/app/agents/new/page.tsx`; YouTube category 27 in
  `src/lib/tools/publish.ts`; seed `scripts/seed-history.mjs` (8 pre-1950 topics:
  Ponzi 1920, South Sea Bubble, Tulip Mania, 1929 Crash, Panic of 1907, Standard Oil,
  Triangle Shirtwaist fire, Wright brothers — all subjects deceased).
  F11 factory `cmrfuvzlv0000t10vqgt6vnxy`, agent `cmrfuvzlx0002t10vvwwliey6`.
- Topic rotation is date-based (`getDate() % len`) → a different topic each day.

### 2. "Real app" experience (LIVE on this machine)
- **Pake (Tauri) desktop app** wraps http://localhost:3000: installed at
  `/Applications/Content Engine.app` + `~/Desktop/Content Engine.app` (replaced the old
  AppleScript launcher; backup at `backup-launcher/Content Engine (terminal launcher).app`,
  gitignored). Rust toolchain was installed via rustup for the build. Pake app = window
  only; server must be running.
- **PM2 keeps the server alive:** launcher (`scripts/dev-start.sh`) now serves a
  **production build** managed by PM2 (`pm2 start npm --name content-engine -- start`),
  with staleness guard: `code_stamp()` hashes git HEAD + **content of uncommitted diffs**
  (fixed: was only the dirty-file list) + schema/lockfile; state in `.dev-server.state`
  ("<mode> <stamp>"). `DEV=1 npm run go` = dev-mode escape hatch. Build-failure falls back
  to dev mode.
- **Login auto-start:** `~/Library/LaunchAgents/com.contentengine.pm2.plist` runs
  `pm2 resurrect` at login (no sudo). `pm2 save` runs on each launcher start.
- PM2 process is named `content-engine` (currently online, ~5h uptime).

### 3. Video-quality overhaul (PR #7, OPEN — this branch)
Round 1 (agent workflow) + round 2 (hand fixes after frame inspection):
- **Remotion resilience:** `src/lib/render/remotion.ts` decode-probes all inputs
  (drops undecodable); `video/TrueCrime.tsx` `<Img>` onError → gradient fallback frame.
  Result: the silent "Remotion died → ffmpeg → NO captions" failure is gone; karaoke
  captions render reliably.
- **ffmpeg caption burn:** `src/lib/truecrime/assemble.ts` writes styled `.ass` and burns
  via libass — BUT this machine's homebrew ffmpeg 8.1.1 has NO libass, so the fallback
  path still ships uncaptioned locally (captions come from Remotion). `RENDER_ENGINE=remotion`
  is set in `.env.local` (untracked/local-only).
- **Archive relevance:** `src/lib/truecrime/footage.ts` — `archiveQuery()` (topic+year+cue,
  living-subject names stripped fail-closed) and `archiveQueryCandidates()` broad-to-narrow
  fallback (archive.org ANDs all terms; specific queries often = 0 hits). Tier walks
  candidates in `src/lib/truecrime/footage/archiveOrg.ts`.
- **Junk-still rejection + Chromium-safe stills:** `src/lib/truecrime/archiveFootage.ts` —
  `validateStillFile` (≥10KB, ≥200px, real decode), poster frames seek a deterministic
  20–70% into reels (never title cards), and `downloadImageFile` now **re-encodes every
  still to baseline JPEG** (`-pix_fmt yuvj420p`) because archive.org serves formats
  headless Chromium can't decode (ffmpeg-passes-but-Chromium-fails was the root cause of
  dark gradient-fallback beats).
- **Framing/mood:** `src/lib/truecrime/kenBurns.ts` letterboxes wide/4:3 over blurred fill
  (no more unreadable extreme crops); `src/lib/truecrime/moodBank.ts` maps finance/history
  cues to urban categories, never botanical.
- **Caption spacing:** `video/TrueCrime.tsx` word margin 9px→16px, active scale 1.12→1.06
  (stroke+scale ate the gaps → "outAmericahimself").
- **Footage ON by default:** both factories' DB configs AND seeds
  (`scripts/seed-{truecrime,history}.mjs`): `footageEnabled/useArchiveFootage/moodBankEnabled: true`,
  `footageLadder: ['archive','stock','moodbank']` (ai_still dropped — keyless local
  gradients are ugly). Mood bank populated 4/27 clips (`npm run moodbank:populate`, rest
  need Pexels keys).
- **Tests 31 → 47** (`src/lib/truecrime/footage.test.ts` +16 pure-helper tests). tsc,
  vitest, prod build all green at commit `38aac1b`.
- **Verified frame-by-frame** (ffmpeg `-ss N -frames:v 1` + Read image): latest video
  `cmrhyip7e00038b2wf8wom9bo` ("The Panic of 1907", review) = karaoke captions with
  correct spacing over real 1907-era newsreel footage on all 6 beats.

### 4. Also this session
- Deep-research report on missing tools (104 agents, all claims live-verified):
  `Updates/2026-07-10-deep-research-missing-tools.md` + memory
  `screen-verification-options.md`. Headlines: **Claude in Chrome** (official, best fit —
  extension page opened in owner's Chrome, awaiting their install; then `/chrome`),
  built-in computer-use MCP (needs Accessibility+Screen Recording perms), Peekaboo
  (fallback), Kinocut mcp-video (only maintained video MCP; optional).
- Owner records: `Updates/2026-07-10-stale-proof-launcher.md`,
  `Updates/2026-07-11-factory-3-real-app-chrome.md` (committed),
  `Updates/2026-07-12-video-quality-round.md` (UNCOMMITTED — untracked on this branch).
- PR #6 (F11 + launcher) MERGED to main 2026-07-12. PR #7 OPEN.

## Current state

- **Working:** everything builds/tests green (47/47). App live at :3000 in prod mode
  under PM2 (`content-engine`, online). Desktop app functional. F11 produced 4 videos
  (all correctly in review): the newest (`cmrhyip7e00038b2wf8wom9bo`) is the quality
  baseline; the older 3 are pre-fix and look worse (fine to reject).
- **Branch:** `fix/video-quality-captions-archive`, pushed, = PR #7. Working tree clean
  EXCEPT untracked `Updates/2026-07-12-video-quality-round.md` (add to the branch or main
  after merge) and `sports-example.mp4` (21MB old sample — NEVER commit).
- **Nothing broken/mid-edit.** Firecrawl MCP still out of credits (research used built-in
  WebSearch fallback fine).
- Known quality gaps (next round, in PR #7 description too): (a) one matching newsreel
  repeats across all 6 beats — needs multi-item diversity; (b) some extracted frames are
  very dark — needs luma check/brightness normalization on poster extraction; (c) a cue
  occasionally starts its caption with a bare punctuation token (", this is") — cosmetic
  tokenizer nit in captions.

## Next steps (ordered)

1. **Wait for owner on PR #7** — on "merge it": `gh pr merge 7 --merge --delete-branch`,
   `git checkout main && git pull --ff-only`, then commit
   `Updates/2026-07-12-video-quality-round.md` to main.
2. **Chrome step (owner):** they install the Claude extension (page was opened at
   claude.ai/chrome), then type `/chrome` in their interactive Claude Code session. After
   that, verify changes in THEIR visible browser instead of headless Playwright.
3. **Quality round 3 (when owner asks):** diversify archive items per beat (search once
   per VIDEO, distribute distinct identifiers across beats; relax collections beyond
   prelinger when <N items match), brightness/luma gate on extracted stills
   (`ffprobe`-mean-luma or ffmpeg `eq=brightness/contrast` normalize), fix punctuation-only
   leading caption tokens (`src/lib/truecrime/captions.ts` token cleanup).
4. **Free keys (owner):** Pexels + Pixabay into `.env.local` placeholders → set
   `useStockFootage: true` in configs/seeds → modern stock B-roll tier + fuller mood bank
   (`npm run moodbank:populate` fetches the remaining 23 categories with a key).
5. **Optional:** install ffmpeg WITH libass (e.g. `brew install ffmpeg --with-...` not
   available; consider `brew install ffmpeg` variants or a static build) if the ffmpeg
   caption-burn fallback should work locally; today captions rely on Remotion (fine).
6. Backlog from before: ElevenLabs MCP (needs explicit owner yes), F12 horror factory
   fast-follow, Remotion smoke script idea, YouTube OAuth creds for publish.

## Key files & context

- **Run app:** `npm run go` (prod+PM2, auto-rebuild on code change). Dev: `DEV=1 npm run go`.
  Restart server after MY edits: just `npm run go` (stamp detects). PM2: `pm2 logs content-engine`,
  `pm2 restart content-engine`. Tests `npm test` · types `npx tsc --noEmit` · build `npm run build`.
- **Trigger an F11 video:** `curl -X POST http://localhost:3000/api/agents/cmrfuvzlx0002t10vvwwliey6/run`,
  poll `/api/videos` until newest F11 video hits review (~3 min). Inspect: get `localPath`
  from Video row (`sqlite3 prisma/prisma/dev.db`), extract frames
  `ffmpeg -ss N -i final.mp4 -frames:v 1 f.jpg`, Read the jpg. Footage provenance: Asset
  kind `footage-map` for the videoId.
- **DB:** `prisma/prisma/dev.db` (Prisma path quirk). Remotion: `RENDER_ENGINE=remotion`
  in `.env.local` (gitignored), falls back to ffmpeg on error — check
  `pm2 logs content-engine` for "Remotion render failed" / "Could not load image".
- **Compliance invariant:** footage stage after `script`, before `compliance`; all
  imagery must land on `ctx.script.visuals` in the `visuals` stage. Never reorder.
- **PostToolUse hook** (`.claude/hooks/check-on-edit.sh`) runs tsc per edit, blocks
  type-error edits — create types before consumers; ignore its eslint duplicate-config
  warnings.
- **Workflow scripts** (reusable/resumable): F11 build
  `.../workflows/scripts/build-f11-history-factory-wf_93206ca1-e43.js`; quality fixes
  `.../workflows/scripts/fix-video-quality-wf_b9f4f4ab-5cc.js` (both under
  `~/.claude/projects/-Users-...-Content-Generation-Platform/57a37488-*/workflows/scripts/`).
- Playwright MCP drives the app headless (screenshots land in repo root/`.playwright-mcp/`).
  Owner CANNOT see those directly — `open <file>` pops them in Preview on their screen.
- archive.org search ANDs terms; collections config `archiveCollections: ['prelinger']`.
  "panic 1907" in prelinger = exactly 1 item (the Lowell Thomas reel) — hence the
  diversity gap.
- Old F11 videos for comparison: `cmrfuymno000313zqazvj750r` (no footage),
  `cmrhx8cl300035d6gc1t1lpkv` (moodbank-only, no captions), `cmrhyb9cw0003ru8brhdn6yan`
  (captions + archive but dark), `cmrhyip7e00038b2wf8wom9bo` (baseline).

## Open questions / decisions pending (owner)

1. **PR #7 — merge?** (they historically say "merge it").
2. **Chrome extension install** — page opened; then `/chrome` in their session.
3. **Free Pexels/Pixabay keys** — unlocks stock tier + full mood bank.
4. **Quality round 3 go-ahead** (variety + brightness + caption-token nit).
5. **Firecrawl credit top-up** (out since 2026-07-10).
6. **ElevenLabs MCP** install yes/no (config change, needs explicit yes).
7. Older pre-fix F11 videos in the inbox: reject or keep? (safe to reject).
