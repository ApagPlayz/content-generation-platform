# Recover runs that got stuck "running" forever

## What I did
- Fixed the problem where a run could spin on **"running"** (and its video on
  **"rendering"**) forever if the app restarted, crashed, or reloaded mid-render —
  which happens on any file save in dev. There was nothing to clean these up.
- Now, every time the scheduler ticks (automatically every 60 seconds, and on the
  "Run due now" button), the app checks for leftover work from a crash and marks it
  **Failed — "Interrupted, the app crashed or restarted while this run was in progress"**
  instead of leaving a spinner that never stops. You can then just re-run it.
- A run is only cleaned up after it's been stuck for **30 minutes**, so a genuinely
  long render is never cut off by mistake. (Adjustable with `RUN_STUCK_TIMEOUT_MIN`.)
- Added automated tests for the timeout logic.

## What I recommend next
- Merge the PR, then to see it in action: start the app, kick off a run, kill the
  server mid-render, and restart — within a minute the stuck item flips to **Failed**
  on the dashboard instead of spinning.
- Optional follow-up (left out to keep this change small): show a one-click
  **"Re-run"** button on interrupted runs, and clean up videos stuck at "queued"
  (not just "rendering") from a very early crash.
