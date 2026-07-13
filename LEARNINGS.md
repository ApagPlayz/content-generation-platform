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
  Fix: every agent workflow must pass e.g. `--allowedTools "Bash(gh:*),Bash(git:*)"`.
  Rule: after any agent run, verify the *outcome* on GitHub (issue/PR/comment exists) —
  never trust the green tick, and always check `permission_denials_count` when output is missing.
