# Deferred features — build later

Tracking for Phase 2+ work intentionally postponed. Captured 2026-06-16.

## 1. Auto-publish for `autonomy = auto` agents
**What:** Agents whose factory `postingDefaults.autonomy === 'auto'` currently still
land their finished video in `approved` status and wait for a human to click
**Publish to YouTube** in the Review Inbox. Wire them to publish automatically.

**Where it plugs in:**
- `src/lib/orchestrator.ts` (and `src/lib/truecrime/orchestrator.ts`) — after the
  final status is set to `approved` for `autonomy === 'auto'`, call
  `publishToYouTube(videoId)` (`src/lib/tools/publish.ts`).
- Respect the daily quota wall (`quotaStatus()` already enforces it — on
  `remaining <= 0`, leave the video `approved` and surface it for manual retry,
  don't throw the whole run).
- Idempotency is already handled in `publishToYouTube` (per video+platform).

**Open decisions:** should auto-publish go straight out, or schedule via the new
`Schedule`/`Post.scheduledFor` path (post at the configured cadence instead of
immediately)? Likely route auto agents through the scheduler for spacing.

## 2. Model tiering (per-stage / per-factory Claude model selection)
**What:** Let each factory/stage pick its Claude model to trade cost vs quality
(e.g. Haiku for routine scripting, Sonnet/Opus for hero content).

**Where it plugs in:**
- `src/lib/tools/script.ts` — currently hardcodes one Claude model. Read a model
  id from factory config (e.g. `factory.config.scriptModel`) with a sane default.
- Surface the choice in the factory create/edit UI (`src/app/factories/new`).
- Feed actual token usage + model into `CostLedger` / `AgentRun.tokensUsed` so the
  cost meter reflects the tier.
- Model ids (latest): `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`.

**Open decisions:** tiering granularity — per factory (simplest) vs per pipeline
stage (script vs future TTS/caption rewrites). Start per-factory.
