# Saved in-progress work, turned on the free voice, prepped publishing — 2026-06-18

## What I did
- **Saved a big batch of unsaved work.** A lot of new work was sitting on your computer
  but had never been "saved" into the project history (it could have been lost). I
  reviewed it, made sure it builds cleanly, and saved it. It includes: a nicer video
  render style (animated captions, proper vertical framing), the new natural voice
  support, model cost controls, automatic retries when a step hiccups, an optional
  auto-publish step, and deeper YouTube analytics (watch time, % watched, subscribers).
- **Fixed a hidden bug** that made the project occasionally fail to build (a background
  timer was clashing with the build). It's now reliable — I built it three times in a row
  with no errors.
- **Turned on the free, natural-sounding voice (Kokoro).** Your Mac only had the old
  robotic voices installed, so I set up Kokoro to run locally on your machine via Docker.
  I tested it end-to-end — it now produces clear, natural narration at no ongoing cost.
  Future videos will use it automatically. (It runs in the background and restarts itself;
  it just needs Docker Desktop to be open.)
- **Wrote you a step-by-step guide to turn on YouTube publishing** (below) — that part
  needs your Google account, so it's the one thing I can't do for you.

## What I recommend next
- **Generate a fresh true-crime video** to hear the new voice in a real clip — say the
  word and I'll run one and send you the result.
- **Turn on YouTube publishing** when you're ready (one-time, ~10 min, your Google login):
  1. Go to console.cloud.google.com → create a project.
  2. Enable "YouTube Data API v3" and "YouTube Analytics API".
  3. OAuth consent screen → External → add yourself as a Test user.
  4. Create an OAuth client ID (type: Web application). Add this redirect URL exactly:
     `http://localhost:3000/api/auth/youtube/callback`
  5. Copy the Client ID + Client secret.
  6. In the app → Settings → paste them in → Save → click Connect → approve.
  7. Optional: tick "Auto-publish to YouTube" if you want auto-agents to post on their own.
- **One note:** if you reboot your Mac, open Docker Desktop once so the voice engine comes
  back online. I can make that fully automatic if you'd like.
