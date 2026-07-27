# Closed two holes in the "don't call someone guilty" safety check — 2026-07-27

## What I did

- **Fixed a hole where the safety check only recognised full names.** Your true-crime
  videos are checked for one dangerous mistake: flatly saying a real, living person who
  was never convicted committed the crime. Until now that check only noticed if the
  script wrote the person's name *exactly* as it's stored. So a case listing
  "John Smith" would be caught by "John Smith killed her" — but sailed straight through
  on "Smith killed her". It now recognises the surname or the first name too.
- **Fixed a bigger hole: people the script invented.** If the AI wrote in a name that
  isn't on the case's list of people at all — a boyfriend, a neighbour, a suspect — the
  check couldn't see them, so nothing stopped the video auto-posting. Now, if the
  narration says someone did the crime and that person was never checked, the video is
  **held for your review** instead of going out on its own.
- **Wrote the first real tests for this part of the app.** This was the highest-stakes
  code in the whole project — the bit that keeps you out of court — and it had *zero*
  tests. It now has 57, so nobody can quietly break it in future without an alarm going
  off.
- **Kept it deliberately careful about false alarms.** Saying "Sarah was murdered in
  her home" is describing the victim, not accusing her — that had to keep passing, and
  it does. Same for "Police killed the suspect", place names, and dates. I also made
  sure a victim who shares a surname with the accused (Mary Smith / John Smith) can
  never be flagged as the suspect.
- **Checked nothing else changed.** All 535 tests pass, the app builds, and the four
  existing demo cases produce byte-for-byte identical results.

## What I recommend next

- **Merge it.** There's a click-by-click check in the pull request that takes about a
  minute and shows both holes closing.
- One thing I deliberately left alone: the app currently shows you only a *count*
  ("2 risky wording flags") in your Review Inbox — not the actual sentence that tripped
  it. Worth a follow-up so you can see what to fix without digging. Say the word and
  I'll open that as its own small job.
- The check still only recognises names the way they're written down. If a case
  involves a nickname ("Bobby" for Robert), it won't connect the two. If that turns out
  to matter, the fix is to let you list nicknames on the case — also a small follow-up.
