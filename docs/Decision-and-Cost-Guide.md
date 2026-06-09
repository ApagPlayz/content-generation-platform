# Decision & Cost Guide — "Content Engine"

**Companion to `PRD.md`.** This document does what you asked: for every major choice, it lays out the **levels/options, the pros and cons, what it actually costs (real dollars, mid-2026), and what each level grants you toward the real objective — making AI content that generates revenue.**

> All prices are current as of **June 2026** and sourced at the bottom. AI-service prices move fast — treat them as planning estimates, not quotes. The app's cost ledger (PRD §10) tracks your *actual* spend.

---

## How to read this: the only number that matters

Everything ladders up to one metric:

> **Profit per video = (revenue it earns) − (cost to make + post it)**

Short-form revenue is roughly **$0.02–$0.10 per 1,000 views** from platform creator funds (highly variable, often lower), plus **much larger** upside from brand deals, affiliate links, and selling your own product/audience. So:

- A video that costs **$0.05** and gets 50k views (~$1–5 in fund payout, plus audience growth) is **wildly profitable** at volume.
- A video that costs **$15** (premium text-to-video) needs to either go big or drive a high-value action (a sale, a brand deal) to pay off.

**This is why generation method = the budget lever.** Cheap assembly scales to thousands of profitable videos; premium generative video only pays off on hero content.

---

## Decision 1 — Generation method (cost per finished ~30–45s video)

You chose "all of them." Here's what each costs and when to actually reach for it.

| Method (factory) | Cost / video | Pros | Cons | Revenue fit |
|---|---|---|---|---|
| **Faceless assembly** (F1 Reddit, F5 listicles, F2 music) | **$0.01–0.25** | Cheapest, fastest, infinitely scalable, fully templatable | Looks "templated" if lazy; needs good hooks/captions to win | ⭐ Best ROI. Volume play. Make 90% of your output here. |
| **Clip repackaging** (F3 shows, F4 streamers) | **$0.01–0.10** (compute) | Near-free in $; rides existing viral content | **Copyright risk is the real cost**, not dollars (see PRD §13) | High ROI *if* rights-safe; can grow fast |
| **Image-to-video / Ken Burns** (F7) | **$0.10–0.50** | Better-looking than flat stills, still cheap | More steps; image gen adds cost | Good "premium-ish" look at scale |
| **AI avatar / talking head** (F8) | **$0.50–2** | Recurring "host" brand; good for reviews/news | Per-minute pricing; can look uncanny | Worth it for a branded music-news anchor |
| **Text-to-video AI** (F6) — Kling/Wan tier | **~$1.50–4** (30s @ $0.05–0.14/s) | Cinematic, original, no rights issues | Expensive; less controllable | Hero/accent clips only |
| **Text-to-video AI** (F6) — Veo/Runway premium | **~$4.50–22+** (30s @ $0.15–0.75/s) | Best quality, lip-sync, 4K, audio | Very expensive at volume | Reserve for showcase pieces |

**Takeaway:** Build the business on faceless assembly + clip repackaging (pennies/video). Use image-to-video and avatars as your "premium tier." Use full text-to-video sparingly — it's a garnish, not the meal, unless a sponsor is paying for it.

---

## Decision 2 — Budget tier (the one you asked me to lay out)

This is the centerpiece. Each tier = a monthly AI/API spend ceiling, what it unlocks, the rough math, and the revenue logic.

### 🟢 Tier A — Lean (< $50/mo)
**What you pay for:** Claude scripting (mostly cached + batched) + **free/local TTS** (Piper/Kokoro) + stock/free b-roll + local rendering. Zero per-clip video-model cost.
**What it grants:**
- ~**300–1,500 faceless videos/month** at $0.01–0.10 each, plus unlimited clip repackaging (compute is free).
- All of F1/F2/F3/F4/F5 fully operational.
**Pros:** Profitable from video #1; basically can't lose money. Forces you to win on hooks/editing (the things that actually drive virality) rather than expensive pixels.
**Cons:** No premium generative look; voice is decent-but-not-ElevenLabs; no avatar.
**Revenue logic:** This is where you *find what works*. Pump volume, read analytics, identify winners. **Recommended starting tier.**

> Rough math: Claude (Sonnet, cached + batched) ≈ **$0.003–0.01/script**; 1,000 scripts ≈ $3–10/mo. Local TTS = $0. → easily under $50 even at high volume.

### 🟡 Tier B — Moderate ($50–250/mo)
**Adds:** **ElevenLabs** premium voice (~$99/mo Pro plan) + occasional image-to-video (F7) + some avatar (F8) + the odd Kling text-to-video hero clip.
**What it grants:**
- Noticeably better audio (voice quality is a top driver of retention on faceless content).
- A branded avatar "anchor" for your music-news factory.
- A handful of cinematic AI clips per week for standout posts.
**Pros:** Production value jumps; still very profitable; differentiates your music content.
**Cons:** Now you must watch spend; premium voice/video can be over-used.
**Revenue logic:** This is the **scale-what-works** tier. Once Tier A shows which factories win, pour Tier B production value into those specifically. Best tier once you have ≥1 proven factory.

> Rough math: ElevenLabs Pro ~$99 + ~$50–100 in image/video/avatar accents + ~$10–20 Claude = **$160–220/mo** for a high-output, polished operation.

### 🟠 Tier C — Generous ($250+/mo)
**Adds:** Heavy text-to-video (Kling/Veo/Runway), avatars at volume, premium everything.
**What it grants:** Cinematic output at scale; the ability to fulfill brand deals that demand AI-generated original footage.
**Pros:** Highest ceiling on quality; lets you say yes to sponsor briefs.
**Cons:** Easy to outspend revenue if you're not yet monetized. A single 30s Veo-Standard clip can cost **$15–22**.
**Revenue logic:** Only justified **after** you have monetization (brand deals, a product, strong RPM) — i.e., when premium clips drive disproportionate revenue, not just views. Graduate here from B; don't start here.

### ⚫ Tier D — Minimize cost above all (≈ $0–15/mo)
**What you pay for:** Open-source/self-hosted everything — local TTS (Piper/Kokoro), local image gen (Flux on your GPU if you have one), free stock, local Whisper, local render. Claude is the only paid piece (and it's cents with caching/batching). Or swap Claude for a cheaper/Haiku-only config.
**What it grants:** A genuinely near-zero-marginal-cost content factory. Volume limited only by your machine and platform rate caps.
**Pros:** Maximum margin; every view is profit.
**Cons:** More setup/maintenance; quality ceiling is lower; needs a capable local machine for image/video gen.
**Revenue logic:** Great for pure-volume faceless + clip channels where virality, not polish, drives the win.

**My recommendation:** **Start at Tier A (Lean)**, instrument everything, and let analytics earn the right to spend. Move winning factories up to **Tier B** once they prove out. Touch **Tier C** only when revenue (not vanity views) demands it.

---

## Decision 3 — Publishing & analytics (you chose: auto-post + auto-analytics)

The "cost" here is mostly **approval friction and rate limits**, not dollars (the platform APIs are free). Levels by effort:

| Level | What you get | Cost / friction | Grants toward revenue |
|---|---|---|---|
| **L1 Generate + manual post** | App makes videos; you post by hand | $0, no approvals, works day 1 | Lets you start *today* while approvals are pending |
| **L2 + auto-analytics** | Pull performance back automatically | Needs read API access (YouTube easy; IG needs Business acct; TikTok needs app) | **The feedback loop** — knowing what wins is what makes the money |
| **L3 + auto-post YouTube** | Auto-upload Shorts | Free API, but **~6 uploads/day** default quota (request increase) | Hands-off YouTube pipeline |
| **L4 + auto-post Instagram** | Auto-publish Reels | Needs IG **Business** acct + **Meta App Review**; 100 posts/24h | Hands-off IG pipeline |
| **L5 + auto-post TikTok** | Direct Post | Dev approval (~1–2 wk) + **audit** (posts are private until audited; ≤5 users/24h unaudited) | Hands-off TikTok pipeline |

**Recommendation (matches PRD §8.4):** Ship **L1+L2** immediately, then add auto-post **YouTube → Instagram → TikTok** in that order (easiest approvals first). The analytics half (L2) is the part that actually drives revenue — prioritize it.

> ⚠️ The two real gotchas to plan around: **YouTube's ~6 uploads/day quota** (file an increase request early) and **TikTok's audit requirement** (posts forced private until you pass it).

---

## Decision 4 — Stack (you chose: local web app)

Confirmed and correct for this use case. Quick comparison of what you *didn't* pick, so you know the trade:

| Option | Cost | Pros | Cons |
|---|---|---|---|
| **Local web app (chosen)** — Next.js + SQLite | $0 infra | One codebase, runs in browser, easiest to extend, cross-platform | You start/stop it locally (a non-issue) |
| Desktop app (Electron/Tauri) | $0 infra | "Product" feel, OS integration | More build complexity; packaging/signing overhead |
| Python + Streamlit/Gradio | $0 infra | Fastest prototype if you're Python-first | Weaker UI for a real dashboard; harder to grow |

**No monthly infra cost** in any case — it's your machine. The only recurring costs are the AI/API services in Decision 2. (If you later want it to run 24/7 without your laptop on, a small VPS is ~$5–20/mo — out of scope for v1.)

---

## Service price reference (mid-2026, sourced)

| Service | Unit price | Notes |
|---|---|---|
| **Claude Opus 4.8** | $5 / $25 per 1M tok (in/out) | Creative tier (your music takes, hooks) |
| **Claude Sonnet 4.6** | $3 / $15 per 1M | Routine scripting workhorse |
| **Claude Haiku 4.5** | $1 / $5 per 1M | Bulk: titles, hashtags, "is this clip viral?" |
| Claude **prompt caching** | cache reads ≈ **0.1×** input | Huge for repeated factory prompts |
| Claude **Batch API** | **−50%** on all tokens | Overnight bulk script generation |
| **ElevenLabs TTS** | ~$0.05 per 1k chars (Flash, Creator); Pro plan ~$99/mo | Or **free** with local Piper/Kokoro |
| **Text-to-video** | $0.05–0.14/sec (Kling/Wan), $0.15/sec (Veo Fast), $0.75/sec (Veo Std), ~$1.50/clip (Runway Gen-4.5) | 30s clip = $1.50 (Kling) to $22 (Veo Std) |
| **Image gen (Flux via fal/Replicate)** | ~$0.003–0.05 / image | 5-image listicle ≈ $0.02–0.25; or local Flux = free |
| **AI avatar (HeyGen/D-ID class)** | per-minute, ~$0.50–2 / short | Plan-based |
| **Whisper captions** | **free** (local faster-whisper) | Word-level timestamps for animated captions |
| **Platform APIs** (YT/TikTok/IG) | **free** | Cost is approval friction + rate caps, not $ |

---

## Putting it together: representative monthly scenarios

| Scenario | Output | Est. AI/API cost | Best for |
|---|---|---|---|
| **Lean volume** (Tier A) | 600 faceless + clip videos | **~$20–40/mo** | Finding winners, pure volume |
| **Polished scaler** (Tier B) | 400 faceless + 30 premium (avatar/image-vid) | **~$160–220/mo** | Scaling proven factories |
| **Sponsor-ready** (Tier C) | Above + 20 cinematic text-to-video heroes | **~$300–500/mo** | When brand deals/products pay |

In all three, if even a handful of videos hit and you've layered in affiliate links / a product / brand deals, the content cost is a rounding error against revenue. **The risk is never the per-video cost at Tiers A/B — it's making content nobody watches.** That's why the analytics feedback loop (PRD §7 stage 7, and Decision 3 L2) is the most important revenue feature in the whole product.

---

## Bottom line

1. **Start Lean (Tier A / D).** Near-zero cost, all core factories working, instrument everything.
2. **Prioritize the analytics loop** (auto-analytics) over auto-posting polish — knowing what wins is the money-maker.
3. **Generate-only + YouTube first** for posting; add IG then TikTok as approvals clear.
4. **Graduate winning factories to Tier B** production value; only touch premium text-to-video (Tier C) once revenue justifies it.
5. **Let the cost ledger + "winners" dashboard drive every spend decision** — never spend on a format the data hasn't validated.

---

### Sources
- Claude pricing & features: bundled Claude API reference (Opus 4.8 $5/$25, Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5; Batch −50%; prompt-cache reads ~0.1×).
- ElevenLabs pricing 2026: elevenlabs.io/pricing/api; elevenlabs.io/blog (PAYG + price cut); bigvu.tv/blog/elevenlabs-pricing-2026.
- Text-to-video API pricing 2026: buildmvpfast.com/api-costs/ai-video; devtk.ai/blog/ai-video-generation-pricing-2026; modelslab.com/blog (Veo/Kling/Sora).
- TikTok Content Posting API & audit: developers.tiktok.com; zernio.com/blog/tiktok-posting-api.
- Instagram Graph API publishing: developers.facebook.com/docs/instagram-platform/content-publishing; postproxy.dev.
- YouTube Data API quota: getphyllo.com/post/youtube-api-limits; elfsight.com.
