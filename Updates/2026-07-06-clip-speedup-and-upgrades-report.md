# Faster clips + sourcing-strategy report — 2026-07-06

## What I did
- **Committed the faster clip download.** The factory used to pull an entire highlight
  reel (10–30 min, ~670 MB); it now grabs just the **first 90 seconds**. Verified on a
  real 30-min video. App is running at **http://localhost:3000** to watch the new flow.
- **Did a deep scan of how real faceless/automation channels source content** (not just
  which stock APIs exist — what the field actually does).
- **Wrote it all into one PDF report:**
  `Updates/2026-07-06-sourcing-strategy-and-upgrades-report.pdf` (opened for you).
- **Updated my notes to your new 32 GB Mac** — which reversed my earlier voice advice.

## Key things the deeper research changed
- **True crime is stills + slow zoom + real records footage — not stock clips.** If we
  only wire up Pexels, videos will look generic. Phase 2 should be a **ladder**: AI image
  + Ken Burns → stock → AI video generation → a **public-records/public-domain footage**
  track (bodycam/dashcam/court exhibits — real and copyright-free).
- **A real monetization risk to design around:** YouTube's July 2025 policy update
  specifically targets "true-crime AI-narrated stories with still images." Defense =
  build in **variation + a genuine editorial layer**, not identical templates.
- **Sports:** survival is strategy, not stealth — target claim-tolerant leagues (NBA
  claims revenue, no strike; NFL/UFC strike hard) and add a **transformation layer**.
- **Voice (corrected):** on your new 32 GB Mac, just keep the free local **Kokoro** voice
  (open Docker before rendering). No need to pay for a cloud voice.
- **AI script writer:** still worth it — **Claude Sonnet 5**, ~1–2 cents per video.

## What I recommend next
- Start **Phase 2** with the footage ladder (AI image + Ken Burns + Pexels/Pixabay).
  You supply two free API keys; I build the matching + a local mood bank + the
  anti-repetition variation.
- Add the public-records footage track for true crime when ready.
- Optional: add a Claude Sonnet 5 key for sharper scripts.
