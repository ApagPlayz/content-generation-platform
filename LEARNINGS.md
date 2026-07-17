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
- *2026-07-13* — **`--allowedTools` REPLACES the default toolset; it does not extend it.** An allowlist
  must name EVERY tool the agent needs (Read/Grep/Task/WebSearch…), not just the new one. And
  `Bash(gh:*)` prefix patterns do NOT match `$(...)`, heredocs or pipes — which these agents write
  constantly. In an ephemeral CI container on a private repo, plain `Bash` is the right call.
- *2026-07-14* — **A CI agent has ONE turn; backgrounded subagents die with it.** Every Task call in a
  workflow agent MUST set `run_in_background: false` so the agent blocks on the result. "I'll wait for
  their findings / report back" = failure: there is no later turn. The job is done only when the
  artifact (issue/PR/comment) actually exists on GitHub, not when the agent decided what to do.
- *2026-07-14* — **A verification step must `exit 1`, never `::warning`.** Scout detected "0 proposals
  before → 0 after" and only warned, leaving the run green. A red run is information; a green run that
  did nothing is a lie.
- *2026-07-14* — **An unassigned issue never reaches the owner.** GitHub's Inbox only notifies you about
  things you authored / are assigned to / @mentioned in. Scout must pass `--assignee <owner>`; Builder
  `--assignee <owner> --reviewer <owner>`. Producing the artifact is not the same as delivering it.
- *2026-07-14* — **The Auditor aborts on bot-authored PRs unless allow-listed.** `claude-code-action`
  refuses non-human actors before turn 1. Set `allowed_bots: "claude"` on the auditor — scope to
  `claude`, never `*`, or another bot's PR (Dependabot etc.) burns a five-agent audit.
- *2026-07-14* — **GitHub cron is best-effort and silently drops runs** (a 2-hour gap was observed).
  Never rely on a schedule for anything a human waits on: trigger on the event
  (`issues: types: [labeled]`) and keep cron as a backstop only.
- *2026-07-14* — **Don't rebuild an issue already being built.** A prompt convention ("comment that you
  started") is not a lock — the next run never reads it. The gate must compute which issues an open
  `claude/` PR already claims (`Closes #N` in the body) and hand the agent an explicit off-limits list.
- *2026-07-14* — **Agents read the issue BODY, not the thread.** `gh issue view` omits comments unless
  you pass `--comments`. The owner's clarifications live there and OVERRIDE the body. When he asks
  @claude to change scope, @claude must edit the body so later runs see it.
- *2026-07-17* — **Volume is not progress; an unreviewed PR is WIP, not output.** The Builder's overnight
  review-queue cap was set to 99 (effectively off), so it kept opening large PRs all night regardless of
  whether the owner had merged the last batch — the queue reached 13 open PRs with the last merge 32h
  earlier, median size climbing. A WIP cap that lifts every night isn't a cap. Keep it bounded, and
  prefer the smallest useful slice: big diffs are exactly the ones that never get reviewed.
