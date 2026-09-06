# Learnings

Every agent working on this repo reads this file before it starts.

It records **mistakes the loop has already made**, so it stops making them. Only failures
and corrections go here — never successes. A file of self-congratulation would just dilute
the context that every future agent has to load.

Rules: max 50 lines. Dated entries. The weekly retro proposes additions via pull request;
nothing is added here without the owner merging it.

---

- *2026-07-13* — **A green Actions run does not mean the agent did its job.** `claude-code-action`
  disables Bash by default; job-level `permissions:` grants GitHub rights, not tool-side ones, so
  every `gh` call was silently denied (`permission_denials_count: 20`, the only place it surfaces).
  Always verify the *outcome* on GitHub (issue/PR/comment exists) — never trust the green tick.
- *2026-07-14* — **A CI agent has ONE turn; backgrounded subagents die with it.** Every Task call in a
  workflow agent MUST set `run_in_background: false` so the agent blocks on the result. "I'll wait for
  their findings / report back" = failure: there is no later turn. The job is done only when the
  artifact (issue/PR/comment) actually exists on GitHub, not when the agent decided what to do.
- *2026-07-14* — **A verification step must `exit 1`, never `::warning`.** Scout detected "0 proposals
  before → 0 after" and only warned, leaving the run green. A red run is information; a green run that
  did nothing is a lie.
- *2026-07-14* — **An unassigned issue never reaches the owner.** GitHub's Inbox only notifies you about
  things you authored / are assigned to / @mentioned in. Scout and Builder resolve the flags in their
  gates; `claude-retro.yml` and `claude-mention.yml` still have no `assignee` handling at all — pass
  `--assignee <owner>` by hand there. Producing the artifact is not the same as delivering it.
- *2026-07-14* — **Agents read the issue BODY, not the thread.** `gh issue view` omits comments unless
  you pass `--comments`. The owner's clarifications live there and OVERRIDE the body. When he asks
  @claude to change scope, @claude must edit the body so later runs see it.
- *2026-07-17* — **Volume is not progress; an unreviewed PR is WIP, not output.** The Builder's overnight
  review-queue cap was set to 99 (effectively off), so it kept opening large PRs regardless of whether
  the owner had merged the last batch — 13 open PRs, median size climbing. Keep the cap bounded and
  prefer the smallest useful slice: big diffs are exactly the ones that never get reviewed.
- *2026-08-02* — **"Approved" is not "buildable" — subtract what's already claimed.** The Builder gate
  computes `approved` and `claimed by an open PR` and never compares them, so `go=true` fires anyway
  and boots an Opus agent that says "Nothing to build" and exits green: 69 such runs to 2 Aug, then
  101 more in the week to 31 Aug. Gate on *unclaimed* approved issues, and make an empty build red.
- *2026-08-02* — **A rebuild after a conflict-close never reads the audit of the PR it replaced.**
  #47 and #54 were closed unmerged for conflicts and re-queued; both rebuilds (#122, #123) were
  re-audited FIX FIRST on fresh defects in the same files. Read the dead PR's audit before coding.
- *2026-08-02* — **The owner buys "the app said it worked and it didn't", not dashboards.** Of the
  measurement/dashboard ideas ever filed, **0 of 4** were approved (#72, #73, #83, #85 — all still
  untouched 40+ days); silent-failure ideas are 7 of 13. Lead with the lie the product tells.
- *2026-08-31* — **Dedup against the `approved` list and open PRs, not just open `proposal`s.** 4 of
  the 23 open proposals duplicate work already approved or shipped when they were filed: #102 → #96
  (merged as PR #99 the next day), #79 → #27 (PR #113), #86 → #17 (PR #112), #109 → #86. And when
  nothing has merged in 30 days, the highest-value number of new ideas to file is zero.
