# Picked up the saved work — accurate, word-synced captions — 2026-06-18

## What I did
- **Continued the work that was paused mid-way.** The leftover changes were the start of a
  caption upgrade, so I finished it.
- **Captions are now timed to the actual voice, word by word.** Until now the app *guessed*
  how long each line of on-screen text should stay up (based on how many letters it had).
  Now it asks the free Kokoro voice engine for the exact moment each word is spoken, so the
  captions line up with the narration instead of drifting.
- **This also unlocks "karaoke" captions later** — each word now carries its own start/stop
  time, which is what's needed to highlight words one-by-one (the TikTok look) when we build
  out the fancy renderer for True Crime.
- **Built in a safety net.** If the voice engine is an older version that can't give exact
  timings, the app automatically falls back to the old guess-based method — narration never
  breaks.
- **Checked it compiles and passes the code checks cleanly.**

## What I recommend next
- **Open Docker Desktop once and let me re-run the factory** so I can confirm the new
  word-timing works on your actual machine. Right now Docker is off, so I built it against
  the documented behaviour and the safety fallback, but I couldn't do a live test.
- **Make one new video and watch the captions** — they should track the voice noticeably
  better than before.
- **When you're ready, I can build the word-by-word highlight effect** (the karaoke look)
  for True Crime videos — the timing data it needs is now in place.
