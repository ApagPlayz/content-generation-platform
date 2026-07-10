# Handoff — Content sourcing strategy, clip-ingest speedup & Phase 2 planning

_Date: 2026-07-06 · Branch: `feat/factory-pipelines-compliance`_

> Self-contained handoff. Assume you (the next session) start cold with zero memory of
> the prior conversation. Read this fully before acting.

---

## Goal

The owner (non-technical, Claude Max 20× plan — token cost is NOT a constraint) asked, in
this order:
1. **Finish and commit** an in-progress change so they can "see the flow." ✅ done.
2. **Research the "real footage" (Phase 2) upgrade** for the video factories. ✅ done.
3. **Cost-benefit on two optional "quality boosts"** (AI script writer + better voice),
   delivered as a **PDF report**. ✅ done.
4. Then the owner pushed for **deeper research** — "are you sure you researched to full
   capability?" — and asked to **spawn a Fable agent to scrape/analyze how other
   automated/faceless content operators source their content**. ✅ done, folded into a
   revised PDF.

The larger ongoing goal for the project: build out **Phase 2 (real moving footage)** for
the True Crime and Sports factories, and decide which quality boosts to enable.

---

## Done so far (concrete, with paths)

### 1. Clip-ingest speedup — COMMITTED (`1816a05`)
- **Files:** `src/lib/tools/clipIngest.ts`, `src/lib/orchestrator.ts`.
- **What changed:** `runClipIngest()` now takes a `windowSec` param (default
  `DEFAULT_INGEST_WINDOW_SEC = 90`, tunable via factory config `ingestWindowSec`). It uses
  `yt-dlp --download-sections "*0-<windowSec>" --force-keyframes-at-cuts` to fetch only the
  first N seconds of the source reel instead of the whole 10–30 min / hundreds-of-MB video,
  and reports the **windowed** `durationSec` (≤ windowSec) so downstream `runMomentDetect`
  bounds stay correct. Orchestrator passes
  `Number(ctx.factoryConfig.ingestWindowSec) || undefined` into the call.
- **Verified:** typecheck passes (`npx tsc --noEmit` → exit 0). Ran a real yt-dlp test
  against a 30-min NBA reel and confirmed ffmpeg fetched only `-t 90.0` (not the full
  669 MB). The change is correct and committed.

### 2. Research (3 subagents, all completed)
- **Agent A (footage/stock APIs)** and **Agent B (quality-boost cost-benefit)** —
  Sonnet, first pass.
- **Agent C (Fable) — practitioner/field scan** of how real faceless/automation operators
  source content. This was the deep one and materially changed the recommendations.
- All three returned full markdown briefs (captured below in "Key context").

### 3. PDF report — WRITTEN & DELIVERED
- **Final PDF:** `Updates/2026-07-06-sourcing-strategy-and-upgrades-report.pdf`
  (~319 KB, 5-part report). This is the v2/deeper version.
- **Companion owner-note (markdown):**
  `Updates/2026-07-06-clip-speedup-and-upgrades-report.md`.
- An earlier thinner PDF (`Updates/2026-07-06-phase2-and-quality-boosts-report.pdf`) was
  **deleted** and replaced by the one above.
- **How the PDF was generated (repeatable):** wrote HTML to
  `<scratchpad>/report.html`, then rendered with headless Chrome:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu
  --no-pdf-header-footer --print-to-pdf="<scratch>/report.pdf" "file://<scratch>/report.html"`.
  (No wkhtmltopdf/pandoc/weasyprint installed; Chrome is the PDF path on this machine.)

### 4. Memory updated (owner got a NEW machine)
- The owner switched to a **NEW Mac with 32 GB RAM** (was 8 GB). Memory file updated:
  `~/.claude/projects/-Users-alessiopagliarulo-Documents-Claude-Projects-Content-Generation-Platform/memory/machine-constraints.md`
  and the `MEMORY.md` index line. **Implication:** memory pressure is no longer a
  constraint; the old 8 GB crash-mitigations (disabled launch agents, tmux resurrect) lived
  on the OLD machine — do NOT assume they exist on the new one.

---

## Current state

- **Working:** clip-ingest speedup is committed and verified. App builds/typechecks.
- **App is RUNNING:** `npm run go` was started; dev server is up at
  **http://localhost:3000** (log at `<scratchpad>/devserver.log`). It may still be running
  in the next session — check with `curl -s -o /dev/null -w "%{http_code}" localhost:3000`.
- **Uncommitted:** only untracked files remain (several `Updates/*.md`, the new report PDF,
  and `sports-example.mp4`) plus the two research markdown notes. Nothing is mid-edit in
  source code. The working tree has NO uncommitted source changes — `1816a05` is clean.
- **Not started:** any actual Phase 2 code. All Phase 2 work is still just research +
  recommendation in the PDF. No footage-sourcing code exists yet.
- **Minor open UX thread:** owner said "i dont see it" about the PDF. It was re-opened in
  Preview + revealed in Finder. If they still can't find it, offer to publish the report as
  a browser **Artifact** (HTML) instead — path is
  `Updates/2026-07-06-sourcing-strategy-and-upgrades-report.pdf`.

---

## Next steps (ordered, specific)

1. **Confirm the owner can see the report.** If not, publish the HTML
   (`<scratchpad>/report.html`) as an Artifact so they can open it in a browser.
2. **Get the owner's Phase 2 go + free API keys.** Phase 2 needs a free **Pexels** key and
   a free **Pixabay** key (~2-min signups, no card). This is the only blocker to starting.
3. **Build Phase 2 as a FALLBACK LADDER, not a single source** (this is the key insight
   from the Fable research — see below). Recommended order of visual sources per beat:
   - **AI still image + Ken Burns pan/zoom** (the true-crime backbone — genre is stills,
     NOT stock video) →
   - **Pexels** vertical stock clip → **Pixabay** →
   - **AI video generation** (Veo 3 / Kling / Runway) for shots stock can't provide →
   - **local curated "mood bank"** (pre-downloaded generic noir clips: rain, foggy house,
     forest, police lights, newspaper macro, empty night street) →
   - existing placeholder as last resort.
   - Separate track for true crime: **public-records / public-domain footage** ingest
     (bodycam/dashcam/court exhibits; archive.org/Prelinger, NASA, LoC) — real and
     copyright-free.
4. **Bake in anti-repetition variation + an editorial layer** (defense against YouTube's
   15 Jul 2025 "inauthentic content" crackdown, which explicitly names "true-crime
   AI-narrated stories with still images"). This ties into the existing compliance engine
   at `src/lib/compliance/`.
5. **Add a `StockClip` Prisma table** (SQLite) keyed by `source + externalId` storing local
   path, width/height/duration, license/attribution text, and which beats used it — for
   caching (Pixabay requires 24h caching) and auto-generating credits where required.
6. **Stitch via Remotion:** each beat → a `<Sequence>` with `<Video objectFit="cover">` in
   the 1080×1920 comp, `durationInFrames` = beat length. ffmpeg equivalent:
   `-ss <in> -t <beatDur> -vf "scale=-1:1920,crop=1080:1920"` then concat-demuxer.
7. **(Optional, owner's call) Enable AI script writer:** add a Claude script key and wire
   the AI writer behind a toggle. Recommended model: **Claude Sonnet 5** (~1–2¢/video).
8. **(Sports genre, when owner wants it) Add a transformation layer** (commentary/analysis/
   edit treatment) + target claim-tolerant leagues (NBA claims revenue, no strike;
   NFL/UFC strike aggressively). Raw windowed downloads alone reproduce the struck pattern.

---

## Key files & context

### Repo run/test (from CLAUDE.md)
- Start/open app: `npm run go` (idempotent; opens http://localhost:3000).
- Restart clean: `lsof -ti:3000 | xargs kill 2>/dev/null; npm run go`
- Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`. Build: `npm run build`.
- DB: SQLite via Prisma; real file at `prisma/prisma/dev.db` (Prisma quirk, not a bug).
  After schema edits: `npm run prisma:push`.
- Render engine: ffmpeg by default; `RENDER_ENGINE=remotion` in `.env.local` uses Remotion
  compositions in `video/`. Preview with `npm run remotion:studio`.

### Files touched / central to Phase 2
- `src/lib/tools/clipIngest.ts` — clip download (just edited).
- `src/lib/orchestrator.ts` — pipeline stages: source → clip-ingest → moment-detect →
  script → … → assemble. `factoryConfig` = `JSON.parse(agent.factory.config || '{}')`.
- `src/lib/tools/momentDetect.ts` — loudest-window heuristic; consumes `durationSec`.
- `src/lib/compliance/` — True Crime legal-compliance engine (caseSelection, claims,
  corroboration, defamationLint, gate, legalStatus, sources, visualLint, variation). Any
  Phase 2 true-crime footage work should respect this. Use the `compliance-reviewer` agent
  after changes here.
- `video/` — Remotion compositions (karaoke captions, 9:16 framing). Named `video/` to
  avoid shadowing the `remotion` npm package; excluded from Next tsconfig.

### Reporting conventions (IMPORTANT — owner is non-technical)
- After meaningful work: plain-bullet chat summary (What I did / What I recommend next) +
  a file in `Updates/YYYY-MM-DD-short-title.md`. Template in `Updates/README.md`. Use the
  `owner-update` skill.
- After ANY change: end reply with the small 3-bullet micro-recap block (Changed / Next /
  Your turn) per global CLAUDE.md.
- Delegate aggressively to subagents (Max 20× plan): Haiku=trivial, Sonnet=moderate,
  Opus=heavy reasoning; run independent agents in parallel.

### The deep research findings (the substance behind the PDF — preserve these)
**How the field sources content (2025–26):**
- Standard stack: AI script → AI voice (ElevenLabs) → footage matched to script → captions
  → upload. Stock named: Pexels/Pixabay/Mixkit/Videvo (free), Storyblocks/Envato/Artgrid/
  Artlist/Motion Array (paid). Some creators say free Pexels beats paid stock.
- 2025–26 shift: **generate the shot** — Veo 3, Kling, Runway, Sora, Luma; and AI stills
  (Flux/DALL·E/Midjourney) + Ken Burns pan (cheapest, most common for narration niches).
- All-in-one tools (Pictory, Visla, InVideo) license Storyblocks/Getty + add AI gen.
  Vexub explicitly targets true crime w/ AI images + Veo 3. Opus/Klap/Submagic just
  repurpose your own long-form.
- "Clipping economy" (Whop) inverts sourcing: rights-holders pay clippers per 1k views and
  hand over footage — legally clean supply.

**True crime specifics:**
- Visual backbone = **stills + Ken Burns**, not stock clips. AI atmospheric establishing
  shots fill gaps. Maps/timelines/documents. Google Earth Studio flyovers of real
  locations. **Public-records bodycam/dashcam** (via FOIA / already-released PD portals) is
  the highest-value, copyright-free source — e.g. "Code Blue Cam" (1B+ views).
- Story/facts from primary sources: PACER + free CourtListener/RECAP, newspapers.com,
  archive.org/Prelinger, NASA, LoC. Not Wikipedia.
- **Risk:** YouTube 15 Jul 2025 update names "true-crime AI-narrated stories with still
  images" as targeted AI slop; "Reused Content" YPP rejections common. Defense = variation
  + genuine human/editorial layer, not templated high-cadence uploads.

**Sports specifics:**
- Per-league enforcement is the load-bearing fact: **NBA claims revenue (no strike)**;
  **NFL/UFC strike/take down hard**. Survivors use transformative commentary/analysis/
  telestration over SHORT windows, licensed access, or "edits" (music+effects) which do
  better on TikTok/IG. Raw broadcast reposts reliably die.

**Cost-benefit numbers (verified 2026-07-06):**
- AI script (assume 2k in / 1k out per video): Claude Haiku 4.5 ≈ $0.007/video ($0.70/100);
  **Claude Sonnet 5 ≈ $0.014–0.021/video ($1.40–2.10/100) — RECOMMENDED**; Opus 4.8 ≈
  $0.035/video. (Note: Sonnet 5 intro pricing $2/$10 per 1M in/out through 2026-08-31, then
  $3/$15.) For comparison: OpenAI GPT-5.4-mini ≈ $0.60/100, Gemini 3.5 Flash ≈ $1.20/100.
- Voice: **Kokoro (local, Docker) is now the recommended default** — free, and the
  memory-leak risk (issue #262, can balloon 20–30 GB) is a non-issue on the new 32 GB Mac.
  Cloud options as optional backup: Google Cloud TTS Neural2 ≈ $0–$1.36/100 (1M free
  chars/mo), Azure Neural similar, OpenAI TTS ≈ $1.28/100, ElevenLabs ≈ $7.72+/100.

---

## Open questions / decisions pending (waiting on owner)

1. **Can the owner see the PDF?** (last message was "i dont see it"). If not → publish as
   an Artifact. File: `Updates/2026-07-06-sourcing-strategy-and-upgrades-report.pdf`.
2. **Green-light Phase 2?** Needs owner to sign up for free **Pexels + Pixabay** API keys.
3. **Which quality boosts to enable?** AI script writer needs a Claude key (owner decision);
   voice = keep Kokoro (no action/purchase needed).
4. **Which genre to prioritize** for the Phase 2 build — True Crime (bigger visual upgrade,
   more legal nuance) or Sports (needs the transformation-layer rethink).
5. Suggested order given to owner: Phase 2 footage ladder first (biggest payoff), with
   anti-repetition variation built in; then AI writer; sports transformation layer later.
