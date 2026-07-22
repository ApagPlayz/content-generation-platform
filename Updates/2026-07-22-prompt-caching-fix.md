# Cut the AI writing bill on true-crime & history videos (issue #90)

## What I did
- Your app already had money-saving "prompt caching" switched on for the AI that
  writes each video's script — but on the **true-crime** and **history/business**
  factories it wasn't actually saving anything.
- The reason: one line in the instructions changes on **every single video** (the
  rotating "editorial angle" that keeps your videos looking varied). Because that
  changing line sat *inside* the part that's supposed to be reused, the cache was
  thrown away and re-billed at full price every time.
- I moved that one changing line just outside the reusable block. Now the big,
  identical chunk of instructions is reused across videos and billed at roughly
  **90% less** — with **zero change** to what the videos say or how they're written.
- The sports factory was already set up correctly, so I left it alone.
- I added two automated tests that lock this in, so a future change can't quietly
  break the saving again. The full test suite, the linter, and a production build
  all pass.

## What I recommend next
- **Merge the PR** — it's a small, safe change (4 files) with no visible difference
  to your videos, only a lower bill.
- After it's live, generate a few true-crime/history videos and glance at the
  spend tracker: the Claude "input" cost per video should drop noticeably once the
  factory is producing videos back-to-back (the discount kicks in on the 2nd video
  onward within a short window).
- Optional follow-up (not done here to keep this small): routing very simple
  scripts to a cheaper model for additional savings. Say the word and I'll open a
  separate issue/PR for it.
