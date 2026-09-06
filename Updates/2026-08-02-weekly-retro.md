# Weekly retro — week of 2026-07-27

## What I did

- Reviewed everything the automation did in the last 7 days and wrote it up as **issue #129**.
- **The honest headline: the loop went quiet for five days.** From 28 July to 2 August it tried
  to build 69 times and produced nothing — and every single attempt reported success, so nothing
  told you it had stopped.
- **The reason is simple and it is not a bug in the AI.** All 10 of your approved ideas already
  have a pull request open waiting for you. The build robot has nothing left it's allowed to
  start, so it wakes up, works that out, and goes back to sleep. Quietly.
- **The loop is blocked on your review, not on ideas.** 11 pull requests are open, 23 suggestions
  have sat untouched for 10–13 days, and the idea robot has correctly stopped filing new ones
  rather than adding to a pile you aren't working through.
- Shipped this week: 1 merged (the legal safety fix). Three older pull requests had sat so long
  they stopped fitting the current code and had to be thrown away and rebuilt from scratch.
- **First time I've worked out what kind of ideas you actually say yes to.** Ideas about *"the
  app said it worked and it didn't"* get approved roughly half the time. Ideas about prettier
  formatting or new dashboard numbers have been approved **zero times out of eight** — every one
  is still sitting there untouched. I've written that down so the idea robot stops proposing them.
- Opened **PR #128** with those lessons recorded, plus two specific fixes for the build robot.

## What I recommend next

1. **Clear the review queue — this is the only thing that unblocks anything.** Start with **#125**
   (the fix for sports videos losing their big hook text). It's the smallest of the batch and the
   automated reviewer passed it clean with no objections. Everything else is waiting behind this.
2. **Merge PR #128 and apply its two build-robot fixes from the dashboard.** The first stops the
   loop going silently idle — it will now say out loud "I'm blocked on your review" instead of
   pretending everything is fine. The second stops rebuilt work from repeating mistakes that were
   already caught and written down once.
3. **Start using the "declined" label on ideas you don't want.** You've never used it, so the idea
   robot has literally never received a "no" and can't learn from one. Closing an idea with that
   label teaches it more than ignoring twenty.
4. **Ask for smaller pull requests.** This week's were more than double the usual size (median 714
   changed lines vs 328). The only one that passed review cleanly was the smallest. Big ones are
   exactly the ones that sit unreviewed until they rot — which is how three were lost this week.
