# Weekly retro — week of 2026-08-31

## What I did

- Reviewed everything the automation did in the last 7 days and wrote it up as a retro issue.
- **The honest headline: the loop produced almost nothing, and it was right not to.** The robots
  woke up **175 times** this week. They opened **1** pull request and merged **0**. Every other
  run correctly decided there was nothing it should do, and went back to sleep.
- **The reason is the same one as last month, and it hasn't moved.** You have **13 pull requests
  waiting for you** — finished, tested work. Eleven of them have been sitting for **29 to 45
  days**. Nothing has been merged since **28 July, 33 days ago**. Both robots are built to stop
  when the pile stops moving, so they have stopped.
- **They stopped quietly, which is the actual bug.** All 175 runs reported "success". Nothing was
  sent to your inbox. The dashboard numbers were byte-for-byte identical for 19 days straight and
  nothing flagged that as odd. A loop that is stuck should say so out loud.
- **One thing is genuinely wasteful.** 101 of those runs started a full AI agent, which spent a
  minute working out there was nothing to build, and stopped. That waste was written down on
  2 August with a fix attached — the fix is still sitting unapplied in pull request **#128**.
- **On the quality of the ideas the robot suggests:** it filed **zero** new ideas this week
  (correctly — the pile is untouched). Looking at the 23 ideas already waiting, **4 of them are
  repeats of work you had already approved or that had already shipped**. I've written that down
  so it stops.

## What I recommend next

1. **Merge or close pull requests. This is the only thing that restarts anything.** Nothing else
   on this list matters until the pile moves. The smallest, cleanest one is **#125** (fixes sports
   videos losing their big hook text) — the automated reviewer passed it with no objections.
2. **Merge #128 first if you only do one thing.** I have now fixed it: last month's version
   contained a broken instruction that would have stopped the build robot permanently, and three
   incorrect facts. It now carries the corrected fix plus this week's lessons, and it changes only
   text files — no app code.
3. **Start using the "declined" label.** Across 54 suggestions you have never once marked one as
   declined. The robot has literally never received a "no", so it cannot learn from one. Closing an
   idea with that label teaches it more than ignoring twenty.
4. **Consider closing the ideas pile.** 23 suggestions have sat untouched for 40 days. If you're
   realistically not going to get to them, closing them is not a loss — it un-jams the idea robot,
   and anything genuinely important will be found again.
