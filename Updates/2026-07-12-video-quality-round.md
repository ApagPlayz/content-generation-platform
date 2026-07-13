# Videos actually look like videos now

_2026-07-12_

## What I did
- You said the videos looked the same and looked bad — you were right, twice:
  1. All the real-footage features were still switched OFF. I turned them on for both
     factories (and made the settings stick).
  2. Even with footage on, frame-by-frame inspection of a real render exposed four bugs:
     no captions (the fancy renderer crashed on one bad image and silently fell back to a
     plain one), irrelevant footage picks (a 1963 bike-safety film in a 1907 story),
     old film cropped into unreadable zooms, and jungle-rain filler clips.
- A team of agents fixed all four, then I caught and fixed two more by testing real
  renders: caption words were glued together, and the smarter search was TOO specific
  and found nothing (it now broadens step by step until it finds era footage).
- **Proof, verified frame by frame:** the newest video ("The Panic of 1907") uses real
  1907-era newsreel footage on every scene and has word-by-word highlighted captions —
  the style every successful faceless channel uses.
- Safety net grew from 31 to 47 automated tests. Everything is up as **Pull Request #7**.

## What I recommend next
- **Say "merge it"** for PR #7.
- Watch the newest Panic of 1907 video in your Inbox and tell me what you think.
- Two known polish items for the next round: more visual variety (one matching newsreel
  currently repeats across scenes) and brightening dark old-film moments.
- The FREE Pexels key would add modern stock B-roll as another footage source — say the
  word and I'll walk you through getting it (2 minutes, free).
- Still open: the Chrome extension step, so I can see your screen directly.
