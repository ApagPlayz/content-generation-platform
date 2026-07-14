# How we could actually "watch" and grade every video before it posts

Research for Issue #21 (stop the sports channel getting killed by copyright strikes).
This is research + a recommended plan — no code changed yet.

## What I did

- Looked at how our pipeline handles a finished video today. The honest finding:
  **nothing ever looks at the actual video.** The app renders `final.mp4`, then
  flips it to "review" or "approved/posted" based only on whether the file exists
  and has sound. No step watches the pixels or listens to the audio. So a
  copyrighted broadcast clip can sail straight through — which is exactly the
  strike risk in Issue #21.
- Researched how other people get an AI to "watch" a video and grade it. Two clear
  facts came back:
  1. **AI models don't watch video directly** — you pull out still frames (say one
     every 2 seconds) and the audio/transcript, then hand those to the model. That's
     how every "let Claude watch a video" tool works today. We already have the
     tool for this (ffmpeg) built into the app.
  2. The proven pattern for grading is an **"AI-as-judge" loop**: give the model a
     clear scorecard, make it explain every score, run it at a fixed setting so it's
     consistent, and check its grades against your own now and then so it stays
     honest.

## What I recommend next — build the evaluation loop

Add one new step to every video, right after it's rendered and **before** it can be
approved or posted. Think of it as a quality-and-safety inspector that actually
looks at the finished clip:

1. **Look** — grab a handful of still frames from the final video plus the audio.
2. **Judge** — hand those to Claude with a scorecard and ask it to grade:
   - **Copyright risk** — does this look like raw league broadcast footage? Is there
     a TV logo/scoreboard/watermark on screen? Is there background music that isn't
     ours?
   - **Transformation checklist** (our defence against strikes) — did we add our own
     voiceover? Reframe it to vertical? Add zoom/overlays/graphics? Keep it short?
     If it's just a cropped re-upload with none of that, it fails.
   - **Basic quality** — is the caption readable, is it actually the exciting moment,
     is anything broken.
3. **Gate (fail closed)** — high copyright risk or a failed transformation checklist
   means the video **cannot auto-post**; it's held in your Review inbox. This also
   finally wires in the license check we already built for the True Crime side but
   never connected to Sports.
4. **Show you** — the verdict *and the actual sampled frames* land in your Review
   inbox, so a risky video is flagged with a picture you can see **before** it goes
   out, not after a strike lands.

There are really **two loops** here, and both matter:

- **The per-video gate** (above) — runs on every single video, every time.
- **A "golden set" check** — a small saved library of example videos you've already
  labelled good or bad. Whenever we change the scorecard or the model, we re-run it
  against that set to make sure the inspector still agrees with you and hasn't gone
  soft or paranoid. This is the piece that keeps the whole thing trustworthy over
  time.

## Honest limits

- We can't run YouTube's real Content-ID copyright scanner on your Mac — nobody
  outside YouTube can. So this is smart rules + an AI eye + leaning on YouTube's own
  pre-publish "Checks" screen. It dramatically lowers strike risk; it can't promise
  zero.
- The AI judge costs a little per video (a few frames + a short grade). Small, and
  worth it next to losing the whole channel to 3 strikes.

## Sources
- Video VLMs in 2026 — frame sampling: https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/video-vlms-frame-sampling-token-streaming-2026
- LLM-based multi-dimensional video quality evaluation: https://arxiv.org/pdf/2506.04715
- Can Claude analyze videos? (2026): https://cutback.video/blog/can-claude-analyze-videos-2026-answer-selects-mpc
- "Let Claude watch videos" frame-extraction tool: https://github.com/bradautomates/claude-video
- LLM-as-a-judge practical guide: https://towardsdatascience.com/llm-as-a-judge-a-practical-guide/
- LLM-as-judge evaluation guide 2026: https://qaskills.sh/blog/llm-as-judge-evaluation-guide-2026
