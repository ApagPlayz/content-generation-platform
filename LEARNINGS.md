# Learnings

Every agent working on this repo reads this file before it starts.

It records **mistakes the loop has already made**, so it stops making them. Only failures
and corrections go here — never successes. A file of self-congratulation would just dilute
the context that every future agent has to load.

Rules: max 50 lines. Dated entries. The weekly retro proposes additions via pull request;
nothing is added here without the owner merging it.

---

- *2026-07-13* — Seeded. No lessons yet; the loop has not produced a pull request.
- *2026-07-13* — **A green Actions run does not mean the agent did its job.** The first Scout
  run finished `success` in 6 minutes, having done all its research, and filed **zero** issues.
  Cause: `anthropics/claude-code-action` **disables Bash by default**. Job-level
  `permissions: issues: write` is NOT enough — it grants GitHub-side rights, not tool-side ones.
  Without `--allowedTools` in `claude_args`, every `gh issue create` was silently denied
  (`permission_denials_count: 20` in the run log, which is the ONLY place it surfaces).
  Rule: after any agent run, verify the *outcome* on GitHub (issue/PR/comment exists) —
  never trust the green tick, and always check `permission_denials_count` when output is missing.
- *2026-07-13* — **`--allowedTools` REPLACES the default toolset; it does not extend it.** The first
  attempt at the fix above passed only `--allowedTools "Bash(gh:*),Bash(git:*)"`. That granted Bash
  and silently revoked `Read`/`Grep`/`Task`/`WebSearch` — denials went UP (20 → 22) and the run
  collapsed from 46 turns to 21. An allowlist must name EVERY tool the agent needs, not just the
  new one. Also: `Bash(gh:*)`-style prefix patterns do NOT match commands containing `$(...)`,
  heredocs or pipes — and `gh issue create --body "$(cat <<EOF...)"` is exactly what these agents
  write. In an ephemeral CI container on a private repo, plain `Bash` is the right call.
- *2026-07-14* — **A CI agent has ONE turn. Backgrounded subagents die with it.** Scout spawned its
  four researchers with the Task tool at its default (background) setting, wrote "I'll wait for
  their findings... I'll report back once the researchers return", and ended its turn at 20 of 50.
  There is no second turn in a one-shot Actions job: the container was destroyed, the four
  researchers were killed mid-flight, and `gh issue create` was never reached. Zero denials, zero
  errors, `stop_reason: end_turn` — a completely green run that produced nothing. It even ran
  `sleep 1; echo "checking..."` as filler while "waiting". Rule: every Task call in a workflow
  agent MUST set `run_in_background: false`, and no agent's job is done until the artifact it was
  asked for (issue / PR / comment) actually exists on GitHub.
- *2026-07-14* — **Never let a verification step pass with a warning.** The Scout verify step
  correctly detected "0 proposals before → 0 after" and emitted `::warning`, which left the run
  GREEN. The owner saw a passing loop that had produced nothing for a day. Verification steps must
  `exit 1`. A red run is information; a green run that did nothing is a lie.
- *2026-07-14* — **An unassigned issue never reaches the owner.** Scout filed 7 correct proposals and
  the owner still saw nothing: GitHub's Inbox only notifies you about things you authored, are
  assigned to, are subscribed to, or are @mentioned in. Issues opened by `app/claude` with no
  assignee match none of those, so they are invisible unless he manually opens the Issues tab.
  Producing the artifact is not the same as delivering it. Scout must pass `--assignee <owner>`;
  Builder must pass `--assignee <owner> --reviewer <owner>`.
- *2026-07-14* — **The Auditor refused to review the Builder's PRs — bot-loop guard.**
  `claude-code-action` aborts before turn 1 when the triggering actor is a Bot:
  `Workflow initiated by non-human actor: claude (type: Bot). Add bot to allowed_bots list.`
  Every Builder PR is authored by the `claude` bot, so the Auditor would never have reviewed a
  single one — the two halves of the loop could not see each other. Fix: `allowed_bots: "claude"`
  on the auditor step. Scope it to `claude`, never `*`, or any bot's PR (Dependabot, etc.) burns
  a five-agent audit.
