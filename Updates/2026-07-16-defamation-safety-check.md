# 2026-07-16 — Tightened the legal safety check on true-crime videos

## What I did

- Opened **PR #47** to fix a hole in the one safety check that keeps the
  true-crime channel out of court — the check that blocks a video from flatly
  saying a *living, not-convicted* real person committed the crime.
- Two problems fixed:
  - It only caught a person if the script used their **exact full name**. Now it
    also catches surname-only ("Smith killed her") and first-name-only ("John
    did it") mentions.
  - If the AI named someone who **wasn't on the case's list at all** and accused
    them, that used to auto-post with no protection. Now it's held for your
    review instead.
- Added the **first real safety tests** for this part of the system (28 checks),
  so this protection can't be quietly broken in future without a test failing.
- Safe cases are untouched: actually-convicted people can still be named, and
  "allegedly" wording still just gets a soft warning.
- The full test suite (244 tests) and the production build both pass.

## What I recommend next

- **Review and merge PR #47** — it's a small, self-contained change (only the
  legal-safety files) and errs on the side of caution.
- The two approved requests already have PRs open (#43 winners-loop, #21
  copyright), so nothing else is waiting on you there.
- A sensible follow-up (separate, smaller): let a case subject store known
  aliases/nicknames so the check catches those too — I left that out to keep
  this change small.
