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
  `gh` calls are silently denied (`permission_denials_count`, the only place it surfaces). Always
  verify the *outcome* on GitHub (issue/PR/comment exists) — never trust the green tick.
- *2026-07-13* — **`--allowedTools` REPLACES the default toolset; it does not extend it.** Name EVERY
  tool the agent needs (Read/Grep/Task/WebSearch…), not just the new one. `Bash(gh:*)` prefix
  patterns do NOT match `$(...)`, heredocs or pipes — which these agents write constantly. In an
  ephemeral CI container on a private repo, plain `Bash` is the right call.
- *2026-07-14* — **A CI agent has ONE turn; backgrounded subagents die with it.** Every Task call in a
  workflow agent MUST set `run_in_background: false`. "I'll wait for their findings / report back" =
  failure: there is no later turn. The job is done only when the artifact exists on GitHub.
- *2026-07-14* — **A verification step must `exit 1`, never `::warning`.** A green run that did nothing
  is a lie; a red run is information.
- *2026-07-14* — **An unassigned issue never reaches the owner.** GitHub's Inbox only notifies about
  things you authored / are assigned to / @mentioned in. Scout must pass `--assignee <owner>`; Builder
  `--assignee <owner> --reviewer <owner>`. Producing the artifact is not delivering it.
- *2026-07-14* — **The Auditor aborts on bot-authored PRs unless allow-listed.** Set
  `allowed_bots: "claude"` on the auditor — scope to `claude`, never `*`, or another bot's PR burns
  a five-agent audit.
- *2026-07-14* — **GitHub cron is best-effort and silently drops runs** (a 2-hour gap was observed).
  Trigger on the event (`issues: types: [labeled]`) and keep cron as a backstop only.
- *2026-07-14* — **Don't rebuild an issue already being built.** A prompt convention is not a lock. The
  gate must compute which issues an open `claude/` PR already claims (`Closes #N`) and hand the agent
  an explicit off-limits list.
- *2026-07-14* — **Agents read the issue BODY, not the thread.** `gh issue view` omits comments unless
  you pass `--comments`. The owner's clarifications live there and OVERRIDE the body; when he changes
  scope, edit the body so later runs see it.
- *2026-07-20* — **Size caps to the owner's review throughput, not to storage — volume is not
  progress.** For three weeks the loop opened PRs and filed proposals faster than he reviewed them:
  0 of 21 proposals ever approved, yet Scout kept topping the pile to its cap of 25 (+10 in a day),
  while his two explicit asks — a "fable-level" UI redesign with drafts (#49) and a video **evaluation
  loop** to watch outputs (#21) — went unbuilt. When he's approving ~nothing, STAND DOWN and stop
  stocking; build what he explicitly asked for before filing net-new ideas; unreviewed = WIP, not output.
