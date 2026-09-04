# On-screen text on sports videos — 2026-07-28

## What I did
- Fixed a bug where the big hook line on a sports video could **vanish completely**.
  If the AI wrote a hook containing a percent sign — like *"Shot 60% from three"* —
  the video still finished and still got published, but with **no text on screen at all**,
  and nothing anywhere told you it had happened.
- Checked the original bug report against the real video software before writing code.
  The report said commas were crashing renders. They aren't — commas have always been fine.
  The real problem was the percent sign, and it was worse than a crash, because a crash
  at least shows up as "failed". This one shipped a silently broken video.
- Apostrophes were also being quietly deleted, so *"It's over"* went out as *"Its over"*.
  That's fixed too — punctuation now reaches the screen exactly as the AI wrote it.
- Found and fixed a second, separate problem while I was in there: the yellow
  "spotlight" labels on transformed clips had a typo in their positioning that made the
  **entire text overlay step fail**. That quietly took your commentary captions down with
  it, so those clips have been going out bare. Both now render.
- Added tests that prove it. They run the real video software, put deliberately awkward
  text through it, and compare the actual pixels against a known-good version. I also
  deliberately re-broke the code twice to confirm the tests actually catch it — they do.

## What I recommend next
- **Nothing needed from you** beyond reviewing and merging the pull request.
- Worth knowing: any sports video already published with a hook containing a `%` went out
  with a blank hook. If you want, I can look back through past videos and list which ones
  were affected so you can decide whether to re-cut any of them.
- Two smaller things I deliberately left alone, happy to pick up as separate jobs:
  - Long hooks can still run off the side of the frame — the text doesn't wrap.
  - Emoji in hooks render as empty boxes, because no emoji font is set for the burned-in
    text. (They work fine on the newer Remotion render path.)
