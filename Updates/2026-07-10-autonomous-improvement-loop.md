# 2026-07-10 — Autonomous improvement hour: 5 PRs to approve + new factory research

You asked me to run for about an hour while you were away: improve the platform, research
new content-factory ideas, and package everything as pull requests (PRs) for you to approve.
Here's everything, in plain language.

## What I did

### 1. Five pull requests are waiting for your approval on GitHub

Nothing merges or goes live until you click approve. **Approve PR #1 first** — the other four
stack on top of it.

- **PR #1 — Bring all factory work to main.** Discovery: your main branch only contained the
  empty starting scaffold; ALL the real work (both factories, the compliance engine, the new
  Phase 2 footage system) lived only on side branches on this computer. This PR makes main the
  true home of the platform. Everything in it was already verified (type-check, production
  build, live render test, independent compliance audit).
  → https://github.com/ApagPlayz/content-generation-platform/pull/1
- **PR #2 — The platform's first automated tests.** 31 tests that guard the video-timing math
  (the thing that keeps picture cuts in sync with the narration). If a future change breaks
  timing, these tests catch it instantly instead of you noticing weird videos.
  → https://github.com/ApagPlayz/content-generation-platform/pull/2
- **PR #3 — The Review inbox now tells you WHY.** Before: a video sat in "review" with no
  explanation. Now each card shows the reason (facts not verified enough, risky wording,
  repeated-footage flag…), the % of facts verified, where each piece of footage came from,
  and the case name. True Crime badge color fixed too.
  → https://github.com/ApagPlayz/content-generation-platform/pull/3
- **PR #4 — Smarter fallback footage.** Courtroom / prison / forest / highway / water /
  interrogation moments now get matching atmosphere clips instead of something random, and
  small old archive clips are upscaled with film-grain treatment instead of looking blocky.
  → https://github.com/ApagPlayz/content-generation-platform/pull/4
- **PR #5 — Honest settings switches.** Some factory settings looked adjustable but were
  secretly ignored by the code. Three switches now genuinely work (mood-bank on/off,
  archive clip limit, stock provider order) and three dead ones were removed.
  → https://github.com/ApagPlayz/content-generation-platform/pull/5

### 2. Research: which new content factories to build next

I researched what people actually run and earn with automated/faceless content in 2025-26.
Top 3 candidates, ranked by fit with what we already built:

1. **History & business-story mini-docs** — "the collapse of Enron in 90 seconds" style.
   Reuses ~90% of the True Crime machine (same script beats, footage ladder, narration).
   Business stories earn 2–4× the ad rate of generic history ($10–25 per 1,000 views reported).
   Fastest possible third factory.
2. **Horror / paranormal stories** — same emotional-narration machine, but fiction — so most
   of the legal/defamation burden disappears. Reported channel earnings $3–10k/month in the
   niche. Needs: a story generator and a darker mood-clip bank.
3. **Finance / AI-news recaps** — the highest earnings ceiling (top ad rates + affiliate
   income), and our fact-checking engine is a genuine advantage there. Needs more new parts:
   a market/news data feed and animated chart scenes.

Also worth knowing: YouTube renamed its policy to target "inauthentic content" (mass-produced
templated video, enforced channel-wide) in mid-2025, and TikTok cuts reach ~73% on AI content
that isn't labeled. Our compliance + variation engine is exactly the moat that makes these
formats survivable — it's a bigger asset than it looks. Formats I checked and would skip:
quiz/trivia shorts (low pay, highest policy risk), lofi/AI-music (whole new pipeline,
tightening enforcement), motivational (most saturated).

### 3. Tools/MCPs worth adding (your call — none installed without your yes)

- **ElevenLabs MCP** (official) — lets me audition voices and test narration in-session.
  Uses the ElevenLabs key you already have. Highest-confidence pick.
- **An ffmpeg video MCP** (community) — cleaner debugging of rendered clips. No key needed.
- **YouTube analytics MCP** (community) — check how uploads perform right in a session.
  Only worth it once you're actively publishing. Needs a YouTube API key.
- Checked and rejected for now: TikTok/Instagram posting MCPs (their APIs are too locked
  down today), Postiz scheduling (requires hosting a whole extra app), extra AI-image MCPs
  (we already have that built in), trend-scraper MCPs (Firecrawl already covers it).

## What I recommend next

1. **Approve PR #1**, then PRs #2–#5 in any order (GitHub will retarget them automatically).
2. Pick the **third factory** — my recommendation is History/business mini-docs first
   (cheapest to build, good earnings), with Horror as the fast follow.
3. Say yes/no to the **ElevenLabs MCP** and I'll set it up next session.

## ⚠️ Your setup checklist (things only you can do)

- **Top up Firecrawl credits** — the web-research tool is out of credits (every search
  returns a payment error). Research this session worked via fallback, but it will bite soon.
- **Approve the PRs** (see list above).
- Optional, unlocks more footage variety: add free **Pexels** and **Pixabay** API keys to
  `.env.local` (placeholders are already there), and run `npm run moodbank:populate` once to
  download the free atmosphere clips for the 6 new scene categories.
- Optional: decide on the ElevenLabs MCP (needs nothing new — reuses your existing key).
