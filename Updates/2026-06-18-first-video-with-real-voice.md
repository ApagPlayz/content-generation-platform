# Ran the factory — first video with the new natural voice — 2026-06-18

## What I did
- **Ran the True Crime factory end-to-end** and opened the finished video for you to
  hear. It's a ~28-second piece on the 1924 Leopold & Loeb case, narrated with the new
  free Kokoro voice (not the old robotic one).
- **Fixed five real bugs I found while getting it to run.** They were all hidden until the
  new voice actually started working. In plain terms:
  - The app crashed every time you tried to make a video, because of how the new
    fancy-render code was being loaded. Fixed.
  - The new background scheduler was accidentally breaking the app's start-up. Fixed.
  - The app was handing the new voice engine a voice name it didn't understand (a leftover
    Mac voice name), so it quietly gave up and used the robotic voice. Now it picks a
    proper natural voice automatically.
  - A file-naming clash made the app fail right after creating the narration. Fixed.
- **Double-checked everything still builds cleanly** (twice) and saved all the fixes.

## What I recommend next
- **Listen to the video** that just opened, and tell me what you think of the voice. If
  you'd like a different tone, there are several free Kokoro voices (warmer, deeper, male/
  female) — I can switch it in a few seconds.
- **Make a few more** so you can compare voices/cases, if useful.
- **Turn on YouTube publishing** whenever you're ready (the 7-step guide is in the previous
  update note) so these can post automatically.
- **Reminder:** the voice engine runs in Docker — if you reboot, just open Docker Desktop
  once and it comes back on its own.
