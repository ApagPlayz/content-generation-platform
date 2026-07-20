# Videos no longer get stuck on "Queued" forever after a crash

## What I did
- Last week's crash-recovery fix only rescued videos that died at the very last
  step (rendering). But a video spends almost all of its time at the earlier
  "Queued" stage — so if the app crashed or restarted before that final step,
  the video was left frozen on a blue **"Queued"** badge with no error, forever.
- I extended the same recovery sweep so a video stuck on **"Queued"** past the
  timeout is now marked **Failed** (with the "Interrupted — re-run?" reason),
  exactly like the rendering case already was.
- I also closed a smaller gap: a background job that crashed while *waiting to
  retry* was never cleaned up either. It now gets healed in the same pass.
- Added tests that go red if either fix is ever accidentally removed.
- No new settings, no database changes. The 30-minute safety timeout is
  unchanged, so a video that's genuinely still working is never touched.

## What I recommend next
- Merge this — it's a small, low-risk continuation of the crash-recovery work
  you already approved (PR #25).
- To see it in action: start a run, close the app before it reaches the final
  render step, wait past the timeout, and the video shows as **Failed** in your
  Inbox instead of sitting on "Queued" forever.
