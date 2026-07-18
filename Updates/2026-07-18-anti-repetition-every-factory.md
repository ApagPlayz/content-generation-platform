# Stop the sports/reddit channel mass-producing near-identical videos

**Issue #17 · Pull request #65**

## What I did
- Your True Crime and History channels already had a built-in brake that stops
  them publishing videos that look like the same template over and over. The
  **sports/reddit** channel did not — it would auto-publish near-duplicates.
- I gave the sports/reddit channel the same protection. Before a video is
  approved it now checks the last 15 videos from that same channel for:
  - the **same opening** (near word-for-word title + hook), and
  - the **same source clip** reused.
- If it spots a repeat, the video is **held for review instead of auto-posting**,
  and the dashboard shows a plain reason why. It never blocks a video outright
  and never deletes anything — worst case it waits for you in Review.
- Why it matters: YouTube demonetizes (and has terminated) channels that pump
  out repetitive, template-identical videos. This was the one channel with no
  brake at all.
- Checked it: full test suite passes (234 tests) and the app builds clean.

## What I recommend next
- **Try it:** run your sports agent a few times back-to-back on the same source.
  The first video goes out; the near-duplicates should land in Review with a
  note explaining why. A genuinely different video still passes through.
- **Review & merge #65** when you're happy — it's assigned to you on GitHub.
- Optional follow-up if you want it later: a matching "why it's in review" badge
  inside the Review inbox itself (today the reason shows on the dashboard queue).
