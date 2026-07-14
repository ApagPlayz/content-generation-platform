# Stop the app from calling broken videos "done"

## What I did
- Fixed a real trust bug: two of your video pipelines (True Crime and History)
  could finish a run, mark the video **approved**, and even **auto-post it** —
  even when the video file never actually got made, or when it came out with
  **no voiceover** (silent).
- Now:
  - **No video file made** → the run stops and shows up as **Failed** with a
    plain reason, instead of pretending it worked. (This is exactly how the
    Sports pipeline already behaved — the other two just weren't doing it.)
  - **Silent video (voice generation failed)** → the video is held in your
    **Review inbox** and is **never auto-posted**, with a clear note in the
    Queue explaining why.
- Added automated tests so this can't silently break again.

## What I recommend next
- Nothing required. This is a small, safe reliability fix behind a pull request
  waiting for your approval.
- If you want, a good follow-up is issue **#15** ("tell the owner WHY an
  auto-post didn't happen") — same spirit, applied to the publishing step.
