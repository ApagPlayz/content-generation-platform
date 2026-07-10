# Built the word-by-word "karaoke" captions for True Crime — 2026-06-22

## What I did
- **Saved the paused work first** so nothing could be lost — the word-timing upgrade is now
  safely committed.
- **Built the TikTok-style "karaoke" captions for True Crime videos.** Until now crime
  videos showed plain captions. Now each word lights up exactly as it's spoken:
  - the word being said pops in **bright amber and slightly bigger**,
  - words already spoken stay **white**,
  - words coming up sit **dimmed** — so the viewer's eye follows along.
- **Gave the visuals real movement.** The old still images now slowly zoom and drift
  (the "Ken Burns" effect), with smooth fades between pictures and a cinematic dark
  gradient so the captions are always easy to read.
- **Built in the same safety net as before.** This new fancy renderer only switches on when
  enabled; if anything goes wrong it automatically falls back to the older simple slideshow,
  so the factory never gets stuck.
- **Checked everything carefully:** the app builds cleanly, passes all code checks, and the
  new video template compiles correctly.

## What I recommend next
- **Do a live test.** I confirmed it all builds, but I couldn't render an actual video on
  your machine yet — the fancy renderer needs a one-time background download (a headless
  browser) the first time it runs. If you say go, I'll switch it on and produce one real
  crime video so you can see the karaoke captions in action. *(This part does not need
  Docker — only the voice does.)*
- **Then compare.** Make one crime video with the new look and tell me if you want tweaks —
  caption colour, size, position, or how fast the pictures move are all easy to adjust.
- **Optional:** once you're happy, we can make this the default for all crime videos.
