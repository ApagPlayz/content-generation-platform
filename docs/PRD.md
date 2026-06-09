# Product Requirements Document — "Content Engine"

**A local-first dashboard for generating, auto-publishing, and analyzing AI short-form video at scale across TikTok, Instagram Reels, and YouTube Shorts.**

- **Owner:** Alessio Pagliarulo
- **Status:** Draft v1.1 (for review)
- **Last updated:** 2026-06-08
- **Working name:** Content Engine (rename later)

> **v1.1 architecture decision (per operator):** Each content method is **its own persistent, semi-autonomous AI agent** that plans, generates, posts, and *adapts itself* from its own performance history. All agents are orchestrated and monitored from **one central automation hub**. Autonomy is a **per-agent toggle** (hands-off auto-run vs. pause-for-review). Build order: **hub/orchestrator first, then plug agents in.** See §5 and §7.

> Companion document: **`Decision-and-Cost-Guide.md`** — the pros/cons, real dollar costs, and revenue rationale for every major build decision below. Read it alongside this PRD.

---

## 1. Vision & one-line pitch

A dashboard that runs on my computer, where I describe a **repeatable video format once** (a "factory"), and the system then mass-produces on-brand short videos for that format, auto-posts them to TikTok / Reels / Shorts on a schedule, pulls back the analytics, and tells me which formats and topics are actually earning — so I can double down on what works and turn viral content into revenue.

It is **not** a single-video toy. It is a **content factory + analytics cockpit**: pick a factory, hit generate, review, publish, learn, repeat.

---

## 2. Goals & non-goals

### Primary goals
1. **Repeatable factories.** Define a content format as a reusable template/workflow and generate unlimited variations from it with minimal clicks.
2. **Multi-format generation.** Support every kind of automatable viral video (see §4), not just one niche.
3. **Auto-publish.** Push finished videos to TikTok, Instagram Reels, and YouTube Shorts directly, on a schedule.
4. **Auto-analytics.** Pull performance data back automatically and present it in a unified dashboard.
5. **Closed feedback loop.** Use analytics to inform what to make next (which formats/topics/hooks win → feed the ideation step).
6. **Cost-aware.** Every generation shows its estimated cost; the system optimizes token/API spend automatically.

### Non-goals (v1)
- Not a multi-tenant SaaS for other users (single-operator, local). Architecture should *allow* this later but we don't build it now.
- Not a long-form (>3 min) video editor.
- Not a manual frame-by-frame editor (timeline tweaks are template-level, not per-clip NLE).
- No mobile app (desktop browser only).

---

## 3. Users & core usage loop

**Single operator (you).** Two recurring sessions:

- **Batch-make session:** open dashboard → pick a factory → enter prompt/topic or let it auto-source trends → generate N videos → review/approve → schedule.
- **Review session:** open dashboard → see analytics → spot winners → clone/iterate the winning factory → schedule more.

The whole product is designed so a daily run takes minutes, not hours.

---

## 4. Content factories (the core mandate)

> **Scope mandate (per your direction):** This product must be able to make *any* type of automatable, repeatable video that can go viral — not just Reddit stories. The factory types below are the launch set; the workflow engine (§7) is generic so new factory types are config, not code rewrites.

Each factory is a named, versioned template with its own pipeline config, prompt presets, visual style, voice, caption style, and posting defaults.

| # | Factory | What it makes | Primary generation method | Notes / risk |
|---|---------|---------------|---------------------------|--------------|
| F1 | **Reddit / story narration** | AITA-style or scary-story narration over gameplay/satisfying b-roll, animated captions | Faceless assembly (TTS + stock + captions) | Cheapest, fastest. Bread-and-butter. |
| F2 | **Music review / music news** | Your take on a release or music-news item — narrated over album art, artist b-roll, beat-synced captions | Faceless assembly + optional AI avatar "anchor" | Your differentiator. Album art / clips raise rights questions — use commentary/transformative framing. |
| F3 | **Show clips** | Clipped + recaptioned moments from popular shows/movies | Clip ingest (yt-dlp/source file) → trim → caption → repackage | **Copyright-sensitive.** Build transformative edits (commentary, reaction, supercuts); see §13. |
| F4 | **Streamer clips** | Auto-find viral stream moments, repackage vertical with captions | Clip ingest + transcript/scene "moment detection" → vertical reframe | Same rights caution as F3; many creators allow clip channels — verify per source. |
| F5 | **Listicle / facts / "Top 5"** | "Top 5 X" countdowns with images + voiceover | Faceless assembly (LLM script + image gen + TTS) | Evergreen, high-volume. |
| F6 | **Text-to-video AI cinematic** | Fully AI-generated b-roll/scenes from prompts | Text-to-video models (Kling/Veo/Runway/Sora) | Highest cost per clip; use sparingly or as accents. |
| F7 | **Image-to-video / Ken Burns** | AI stills animated with pan/zoom + VO (middle-cost look) | Image gen → motion + assembly | Good cost/quality middle ground. |
| F8 | **AI avatar / talking head** | A presenter reads a script (music-news anchor, explainer) | Avatar API (HeyGen/D-ID style) | Good for recurring "host" branding. |

**Shared pipeline truth:** F1, F2, F5, F7 are mostly *assembly* (cheap, scalable). F3/F4 are *clip repackaging*. F6/F8 are *generative* (expensive). The engine treats all of them as the same staged pipeline (§7) with different stage implementations.

---

## 5. High-level architecture — hub + agent fleet

A central **hub** owns everything shared (dashboard, scheduling, platform auth, the media/render tools, the publish + analytics adapters, the cost ledger). Each content method is an independent **agent** with its own *playbook* (system prompt), its own *memory* (what's worked for it), and its own *autonomy setting*. Agents don't each reinvent infrastructure — they **call the hub's shared tools**. Add, edit, pause, or remove one agent without touching the others.

```
┌───────────────────────────── AUTOMATION HUB (local web app) ─────────────────────────────┐
│  Dashboard · Agent manager · Scheduler · Review inbox · Unified analytics · Cost ledger    │
│                                                                                            │
│  ┌─────────────────────────── ORCHESTRATOR ──────────────────────────────────────────┐   │
│  │  schedules agent runs · enforces autonomy/approval · supervises · meters budget     │   │
│  └───┬──────────────┬──────────────┬──────────────┬───────────────────────────────────┘   │
│      │ run          │ run          │ run          │ run                                     │
│  ┌───▼────┐    ┌────▼───┐    ┌─────▼───┐    ┌─────▼────┐   each AGENT =                     │
│  │ Reddit │    │ Music  │    │  Show   │    │ Streamer │   • playbook (system prompt)       │
│  │ agent  │    │ agent  │    │ clips   │    │ clips    │   • memory (its learnings/winners) │
│  │        │    │        │    │ agent   │    │ agent    │   • autonomy: auto │ review         │
│  └───┬────┘    └────┬───┘    └────┬────┘    └────┬─────┘   • shares the hub tool-belt ↓     │
│      └──────────────┴─────────────┴──────────────┘                                          │
│                            │ all agents call the SHARED TOOL-BELT                            │
│  ┌─────────────────────────▼──────────────────────────────────────────────────────────┐   │
│  │ source/trends · script(Claude) · TTS · image-gen · video-gen · clip-ingest(yt-dlp) · │   │
│  │ caption(Whisper) · assemble(Remotion+ffmpeg) · review-gate · publish · analytics-read │   │
│  └──────────────┬───────────────────────────────┬───────────────────┬──────────────────┘   │
└─────────────────┼───────────────────────────────┼───────────────────┼─────────────────────┘
                  │                               │                   │
           ┌──────▼──────┐               ┌────────▼────────┐   ┌──────▼─────────┐
           │ Job queue   │               │  SQLite (local) │   │ local /media   │
           │ BullMQ+Redis│               │  Prisma ORM     │   │ + agent memory │
           └─────────────┘               └─────────────────┘   └────────────────┘
       external: Claude API · TTS/image/video providers · YouTube/TikTok/Instagram APIs
```

**What "agent" means here (bounded, not runaway):** each agent reasons over its task using the shared tools, and **adapts by reading its own analytics memory** ("my last 20 winners had X hooks → lean into X") to choose topics, hooks, and styles. It does **not** rewrite its own code or spend outside its budget — the orchestrator caps tokens/$ per run and the autonomy toggle gates posting. Adaptation = smarter choices over time, within guardrails.

### 5.1 Recommended stack (rationale in cost guide)

- **UI + server:** Next.js (App Router) + TypeScript + Tailwind + shadcn/ui. One codebase, runs locally (`localhost:3000`), trivially extensible.
- **DB:** SQLite via **Prisma**. Local, zero-ops, easy to back up (single file). Schema in §6.
- **Job queue:** **BullMQ + Redis** (Redis via Docker or `brew install redis`). Rendering and uploads are long-running and must survive page reloads / run in the background. *Fallback if you want zero Redis: a simple SQLite-backed job table with a polling worker — fine at low volume.*
- **Video assembly:** **Remotion** (React components → MP4). This is the key recommendation — it makes templated videos with animated captions, transitions, and beat-sync **as reusable code components**, which is exactly the "define a format once, mass-produce" requirement. ffmpeg underneath for clip cutting/concat/encode.
- **Captions/transcription:** **faster-whisper** (local, free, word-level timestamps) for animated captions and for transcribing source clips in F3/F4.
- **Clip sourcing:** **yt-dlp** for ingesting source video (F3/F4) — *with the legal guardrails in §13.*
- **Scripting/ideation/decisioning:** **Claude API** (`claude-opus-4-8` for creative, `claude-sonnet-4-6` for bulk scripting, `claude-haiku-4-5` for cheap classification like hashtag/title gen). Token strategy in §10.
- **TTS / image / video / avatar:** pluggable providers behind a common interface (so you can swap cheap↔premium per factory and per budget). Provider matrix and costs in the cost guide.
- **Agent runtime — DECIDED: (A) local agent loops (cheapest).** Each agent is a **Claude tool-use loop** where the agent's *playbook* is the system prompt, the *shared tool-belt* (§5) are the tools, and the agent's *memory file* carries its learnings. The loop runs **inside the hub's Node/BullMQ workers via the Claude API** — fully local, no hosting/orchestration cost (you pay only Claude tokens + media services), and the heavy media work (ffmpeg/Remotion/large files) stays on your machine. The orchestrator is just our own scheduler.
  - **Swappable upgrade path (not v1):** **Anthropic Managed Agents (CMA)** would host the loop with built-in versioning + **memory stores** + **outcomes**, paired with a self-hosted sandbox. It is **strictly more expensive** (managed orchestration + container hours) for the same output, so we only adopt it later to buy hands-off convenience at scale — never to save money. The agent abstraction is built runtime-agnostic so this remains a config swap.

---

## 6. Data model (SQLite / Prisma — initial)

```
Factory        id, name, type(F1..F8), version, config(json), promptPresets(json),
               styleConfig(json), voiceConfig(json), captionConfig(json),
               postingDefaults(json), createdAt, updatedAt, archived
Video          id, factoryId, status(draft|queued|rendering|review|approved|
               scheduled|published|failed), title, description, hashtags(json),
               scriptText, sourceRef(json), localPath, thumbnailPath, durationSec,
               costEstimate, costActual, createdAt
Asset          id, videoId, kind(voiceover|image|clip|music|broll|caption),
               provider, providerJobId, localPath, costActual, meta(json)
Job            id, videoId, stage, status, attempts, error, startedAt, finishedAt
Post           id, videoId, platform(tiktok|instagram|youtube), platformPostId,
               scheduledFor, publishedAt, status, permalink, error
Metric         id, postId, capturedAt, views, likes, comments, shares, saves,
               watchTimeSec, avgWatchPct, followsGained, revenue(json), raw(json)
PlatformAuth   id, platform, accountHandle, tokens(encrypted json), scopes,
               expiresAt, status
CostLedger     id, videoId, service, units, unitCost, total, currency, at
Setting        key, value   // budgets, default providers, API keys (encrypted)
```

Design notes: `Factory.config` is the generic pipeline definition (§7) so new factory types need no schema change. `Metric` stores `raw` platform payloads verbatim so we can re-derive new KPIs later. API keys/tokens encrypted at rest (local key in OS keychain).

---

## 7. The agent model (heart of the product)

Each content method is an **agent**: an independent, persistent, self-adapting worker that produces and posts videos for *one* format. All agents share the hub's tool-belt; what makes them individual is their **playbook**, **memory**, and **autonomy setting**.

### 7.1 Anatomy of an agent
| Part | What it is | Stored as |
|------|------------|-----------|
| **Playbook** | The agent's "how to make great videos for *this* format" system prompt — voice, hook patterns, structure, visual style, posting cadence, do/don'ts. Stable → heavily prompt-cached. | `Factory.config` + `promptPresets` (versioned) |
| **Memory** | What this agent has learned: its past videos, which hooks/topics/styles won, current strategy notes. Read at the start of every run; updated after analytics come in. | `/media/agents/<id>/memory` (+ `Metric` history) |
| **Tool-belt** | Shared hub capabilities the agent calls (table below). | hub services |
| **Autonomy** | `auto` (run → make → post hands-off) **or** `review` (pause for your approval before posting). **Per-agent toggle.** | `Factory.postingDefaults` |
| **Budget** | Per-run token/$ cap the orchestrator enforces. | `Setting` / per-agent |

### 7.2 The shared tool-belt (what every agent can call)
| Tool | Purpose | Implementation |
|------|---------|----------------|
| `source/ideate` | Decide what to make | manual topic, trend scrape (browser automation), RSS/music-news feed (F2), clip URL/file (F3/F4), or **its own memory** ("make more like my winners") |
| `script` | Narration + title + hashtags + hook | Claude (structured JSON output, cached playbook prefix) |
| `tts` / `image` / `video` / `avatar` | Produce media | pluggable providers (cheap↔premium per budget) |
| `clip-ingest` | Pull + trim source clips, detect viral moments | yt-dlp + Whisper transcript + scene/moment scoring (F3/F4) |
| `caption` | Word-level animated captions | faster-whisper |
| `assemble` | Compose final vertical MP4 | Remotion + ffmpeg |
| `review-gate` | Ask the operator to approve/edit (only when autonomy = `review`) | tool-confirmation → Review inbox |
| `publish` | Post to selected platforms (schedule-aware, quota-aware) | YouTube / TikTok / IG adapters |
| `analytics-read` | Pull performance into memory | per-platform analytics adapters → `Metric` |

### 7.3 An agent run (one cycle)
```
orchestrator triggers agent (schedule, manual, or "make N")
   → agent reads its memory (what's been winning)
   → source/ideate  → script  → media (tts/image/video/clip)  → assemble
   → IF autonomy=review: review-gate (waits for you)   IF autonomy=auto: continue
   → publish (respecting platform quotas/caps)
   → later: analytics-read → write learnings back to memory  ← the adaptation loop
```
Each tool call is a BullMQ job (retries w/ backoff, visible in the dashboard, costs logged to `CostLedger`). The agent loop itself runs per the chosen runtime (§5.1: local loop for v1).

### 7.4 Why this satisfies "each its own thing, one automation area"
- **Its own thing:** every agent is isolated — its own playbook, memory, autonomy, schedule, and cost line. Editing or pausing the Music agent never touches the Reddit agent. New format = new agent (new playbook + maybe one new tool), not a new app.
- **One automation area:** the hub is the single place to create/launch/monitor agents, approve review items, see unified analytics, and watch spend. The orchestrator is the shared "automation engine" all agents run on.

---

## 8. Publishing & analytics — the hard, gated parts

You chose **auto-post + auto-analytics**. These require platform developer accounts and approvals; plan around them. (Sources at end.)

### 8.1 YouTube Shorts
- **Upload:** YouTube Data API v3 (`videos.insert`). A Short = vertical 9:16, ≤60s, `#Shorts` in title/description.
- **⚠️ Quota wall:** default project quota is **10,000 units/day**, and an upload costs ~1,600 units → **~6 uploads/day per project**. For higher volume, file a **quota increase request** with Google (or rotate projects — within ToS limits). Build the system to track remaining quota and warn before hitting it.
- **Analytics:** YouTube Analytics API (views, watch time, avg view %, subs gained, and revenue if monetized/partner).

### 8.2 TikTok
- **Posting:** TikTok **Content Posting API** (Direct Post). Requires developer registration + app + approval for the posting scope. Approval is manual (commonly ~1–2 weeks; faster with a clean use-case + demo + privacy policy).
- **⚠️ Audit gate:** until your API client passes TikTok's audit, posts are forced to **private** and **unaudited clients allow ≤5 users posting / 24h**. Plan: ship unaudited (private posts) for testing, then submit for audit to go public.
- **Analytics:** TikTok Display API / research/analytics endpoints (views, likes, comments, shares).

### 8.3 Instagram Reels
- **Posting:** Instagram **Graph API** content publishing. Requires an Instagram **Business** account (Creator accounts can't publish via API), a linked Facebook app, and **Meta App Review** for `instagram_business_content_publish`.
- **Limits:** Reels for the tab should be 9:16 and ~5–90s; **100 API-published posts / rolling 24h**.
- **Analytics:** Graph API insights (reach, plays, likes, comments, saves, shares).

### 8.4 Phasing recommendation
Even though the target is full auto-post + auto-analytics, build in this order so you're never blocked:
1. **Generate + local export** (works day one, no approvals).
2. **YouTube** auto-post + analytics (easiest API access).
3. **Instagram** (needs Business acct + app review).
4. **TikTok** (needs posting-scope approval + audit for public).
Design the `Post`/`Metric` adapters as a common interface so each platform is a plug-in.

---

## 9. Dashboard UI (screens)

1. **Home / Cockpit** — KPIs across all platforms (views, follows, est. revenue, best video this week), cost-this-month vs budget, queue status, "make more like this" shortcuts to winning factories.
2. **Agents** — list/create/edit/clone/version agents (each = a factory playbook); per-agent defaults (style, voice, captions, providers, schedule) and the **autonomy toggle** (`auto` vs `review`), plus a per-agent run/pause control and cost line.
3. **Generate** — pick factory → enter topic(s) or batch list / paste clip URLs / accept trend suggestions → see live cost estimate → enqueue N videos.
4. **Queue** — live pipeline view (per stage), retry/cancel, error surfacing.
5. **Review inbox** — where agents set to autonomy=`review` queue finished videos: preview, edit script + caption + title/hashtags, approve / regenerate / reject (this is the `review-gate` tool surface).
6. **Calendar / Scheduler** — drag videos onto a posting calendar per platform; respects per-platform rate caps & quota.
7. **Analytics** — unified table + charts; filter by factory/platform/topic; "winners" view that surfaces top performers and one-click clone-to-make-more.
8. **Settings** — API keys (encrypted), platform auth (OAuth connect buttons), budgets/alerts, default providers, model tiers.

---

## 10. Token & cost optimization (Claude usage)

Because each factory generates many videos from a **stable** prompt template, the workload is ideal for aggressive optimization. Built into the scripting/ideation layer:

> **Agent-loop note:** because each agent *reasons* over tool calls (not a one-shot prompt), it spends more tokens per video than a plain script call. That makes the levers below — especially caching the stable playbook and setting low `effort` for routine agents — even more important. The orchestrator's per-run token cap (§7.1) is the backstop.

1. **Prompt caching.** Each agent's playbook (system prompt) + style guide + few-shot examples are **stable** → mark them with `cache_control: {type:"ephemeral"}`. Repeated runs from the same agent pay ~0.1× on the cached prefix instead of full price. Put only the per-video topic after the cache breakpoint. (Cache reads ≈ 0.1× input cost; this is the single biggest lever for a high-volume agent.)
2. **Model tiering.** `claude-haiku-4-5` for cheap/bulk (hashtags, titles, classification, "is this clip viral?"), `claude-sonnet-4-6` for routine scripts, `claude-opus-4-8` for creative/complex (your music takes, hooks worth getting right). Make the tier a per-factory setting.
3. **Batch API** (`/v1/messages/batches`) for non-realtime bulk: generating 50 scripts overnight → **50% cheaper**. Use it for scheduled batch-make runs.
4. **Structured outputs** (`output_config.format` JSON schema) so scripts come back as `{hook, body, cta, title, hashtags[]}` — no fragile parsing, fewer retries.
5. **Token counting** before big batches (`count_tokens`) to show accurate cost estimates in the Generate screen.
6. **Adaptive thinking + effort.** Use `thinking:{type:"adaptive"}`; set `effort` low for bulk, higher only for the creative tier.
7. **Cost ledger.** Every Claude call (and every TTS/image/video call) writes to `CostLedger` so the dashboard shows real spend per video, per factory, per month, against budget — with alerts.

(All current Claude model IDs/prices used here are verified against the bundled Claude API reference: Opus 4.8 $5/$25 per 1M, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5.)

---

## 11. Recommended Claude Code plugins / MCP servers

You'll build this *with* Claude Code; some MCPs also help at **runtime**. Recommended:

**For building the app (Claude Code workflow):**
- **Filesystem MCP** — manage the `/media`, templates, and asset directories.
- **SQLite/Postgres MCP** — let Claude inspect/query the local DB while developing.
- **Playwright / Puppeteer MCP** — drive a browser for (a) scraping platform "trending" pages for the Source stage where no official API exists, and (b) any platform that lacks a clean publish API.
- **Fetch / web search** (built-in tools) — music-news sourcing (F2), trend research.
- **Sequential-thinking MCP** — helps Claude plan the multi-stage pipeline code.

**For runtime (optional, inside the app):**
- The app itself calls the **Claude API** directly (not via MCP) for scripting — that's the right boundary.
- Consider a small internal **"trends" service** using the Playwright MCP pattern for the Source stage.

> Note: Claude Code's *Managed Agents / Workflow* features are useful if you later want the platform itself to run autonomous "make + post + learn" loops on a schedule — but for v1, plain Claude API calls inside BullMQ workers are simpler and cheaper.

---

## 12. Non-functional requirements
- **Local-first & private:** runs on your machine; no third-party hosting of your strategy/analytics. API keys encrypted at rest (OS keychain).
- **Resilient jobs:** rendering/uploads survive crashes & reloads (queue-backed, idempotent stages, retries).
- **Observable:** queue UI, per-stage logs, cost ledger, quota meters.
- **Backup:** SQLite file + `/media` are the whole state; one-command backup.
- **Extensible:** new factory types and new platforms are plug-ins, not rewrites.

---

## 13. Legal, rights & policy risks (read before F2/F3/F4 at scale)
- **Show/streamer clips (F3/F4) & music/album art (F2)** carry copyright exposure. Reduce risk by making edits **transformative** (commentary, reaction, criticism, supercuts with original narration), keeping clips short, and crediting sources. This is *risk reduction, not legal advice* — for a revenue business, get real counsel before scaling clip channels.
- **Platform automation policies.** Auto-posting must respect each platform's API ToS and rate caps (encoded in §8). Avoid spammy volume; platforms penalize it.
- **Music licensing.** Use a licensed library (e.g., a subscription stock-music service) for background beds rather than copyrighted tracks.
- **AI disclosure.** Some platforms require labeling AI-generated/altered content — add an "AI-content" flag to the publish step.

---

## 14. Phased roadmap (**hub-first**, per operator decision)

- **Phase 0 — Hub foundation (2–3 wk):** Next.js app, SQLite/Prisma schema, BullMQ. Build the **orchestrator + swappable agent-runtime abstraction** (local loop), the **shared tool-belt interfaces** (stubbed), cost ledger, the **Agent manager** UI, and the **Review inbox**. No finished videos yet — this is the automation area every agent plugs into.
- **Phase 1 — First agent end-to-end (2–3 wk):** Implement the real tools the **Reddit agent (F1)** needs (`script → tts → caption → assemble`) → first agent produces a **local MP4** at autonomy=`review`. Wire prompt caching + model tiering. Proves the agent model on the hub.
- **Phase 2 — Publish + analytics loop (2–3 wk):** `publish` + `analytics-read` tools. **YouTube first** (auto-post + analytics → agent memory), scheduler/calendar, quota meter. Then Instagram (after Business acct + app review).
- **Phase 3 — Fleet out (2–3 wk):** Stand up the **Music (F2)** and **Listicle (F5)** agents from the same framework; wire the **adaptation loop** so each agent reads its analytics memory to "make more like its winners."
- **Phase 4 — Clip agents (2–3 wk):** **Show (F3)** and **Streamer (F4)** agents — `clip-ingest` (yt-dlp + Whisper + moment detection + vertical reframe) with the rights guardrails (§13).
- **Phase 5 — TikTok + autonomy + generative (2–3 wk):** TikTok posting (private→audited); flip per-agent autonomy to `auto` for trusted agents; add generative agents **F6/F7/F8** as premium accents; unified "winners" analytics view.

---

## 15. Success metrics
- **Throughput:** videos generated & published per week with <X min operator time.
- **Cost efficiency:** avg fully-loaded cost per published video (target ranges in cost guide); % spend cached/batched.
- **Performance:** median views, follower growth, and **revenue per 1k views** by factory.
- **Loop quality:** do analytics-driven "make more like this" videos outperform baseline? (the real proof the system works).

---

## 16. Open questions (for you)
1. Which platform do you want **first** for auto-post — YouTube (easiest API) or TikTok/IG (where your audience is)?
2. Do you already have a TikTok/IG **Business** presence and a Facebook developer account? (gates IG/TikTok timelines)
3. Initial monthly **budget ceiling** for AI/API spend? (sets default provider tiers — see cost guide)
4. For F2, is the music content **your original commentary/reviews** (lower rights risk) vs. re-posting others' content?
5. Preferred **brand voice / TTS voice** — premium (ElevenLabs) or free/local to start?

---

### Sources (platform/API facts)
- TikTok Content Posting API access & audit: developers.tiktok.com; zernio.com/blog/tiktok-posting-api; tokportal.com.
- Instagram Graph API publishing (Business acct, app review, 100 posts/24h): developers.facebook.com/docs/instagram-platform/content-publishing; postproxy.dev.
- YouTube Data API quota (~10k units/day ≈ 6 uploads): getphyllo.com/post/youtube-api-limits; elfsight.com.
