# Hook-strength badge for true-crime & history videos

## What I did
- Your sports videos already show a colour-coded **"Hook strength /100"** badge in the
  Review Inbox — a quick read on whether the opening line is strong enough to stop the scroll.
- True-crime and history videos were the two factories *not* getting that badge: the field
  sat blank. I wired them up so **every** video, all three factories, now shows the same badge.
- It reuses the exact same scoring tool the sports factory already uses (no new AI cost, no
  new concept), so a green/yellow/grey badge now appears on true-crime and history cards too.
- Added tests for the new scoring wrapper. The full test suite (189 tests) and the production
  build both pass.

## What I recommend next
- **Try it:** generate one new true-crime and one new history video, open the Review Inbox,
  and check each card now shows a "Hook strength" badge (green = strong, yellow = okay,
  grey = weak) just like sports.
- I deliberately kept this small: I turned on the **badge** but did **not** add the sports
  factory's extra step of brainstorming 3–5 alternative opening lines and picking the best.
  That's a bigger, riskier change. If you'd like true-crime/history to also *shop around* for
  the strongest opener (not just score the one it wrote), say the word and I'll do that as a
  separate follow-up.
