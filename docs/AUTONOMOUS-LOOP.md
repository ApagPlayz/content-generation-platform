# The autonomous improvement loop

How this repo improves itself while the computer is off, and what you do from your phone.

## What runs, and when

| Loop | When | What it does |
|---|---|---|
| **Scout** | Mondays 6am | Researches the market and the codebase. Files up to 5 issues labeled `proposal`. Never writes code. |
| **Builder** | Nightly 3am | Takes the oldest issue you labeled `approved` and builds it. Opens one pull request. |
| **Auditor** | Every pull request | An independent agent attacks the PR from five angles and posts a verdict before you read it. |
| **Metrics** | Daily 7am | Recomputes `LOOP-DASHBOARD.md` from what actually merged. No agent, no tokens. |
| **Retro** | Sundays 6pm | Reads the week's real outcomes and proposes fixes to the loop itself. |
| **@claude** | Whenever you type it | Comment `@claude do X` on any issue or PR and an agent picks it up. |

## Your job (this is the whole manual)

1. **Monday, 5 minutes.** Open the GitHub app → Issues. Read the proposals. Add the
   `approved` label to the ones you want. Close the rest. **Nothing gets built until you do
   this** — the system is inert on purpose.
2. **When a PR arrives.** Read the plain-English description and the auditor's verdict. Merge,
   or comment what's wrong. Your comments are what the retro learns from, so say why.
3. **Sunday.** Skim the retro issue. It tells you whether this is working.

That's it. Everything else is automatic.

## The one number that matters

`LOOP-DASHBOARD.md` — open it in the GitHub app. **Merge rate** is the health check. If you're
merging most of what the agents build, it's working. If you're throwing most of it away, the
loop is generating noise and the retro will tell you why.

Watch for the classic failure: **PR size climbing while merge rate falls.** That means the
agents are writing more and getting it right less. It's the single best early warning that the
loop has gone bad.

## Guardrails

- Agents never push to `main` and never merge their own work. You merge. Always.
- One agent PR open at a time. No pile-ups.
- Agents only build what you labeled `approved`. They cannot invent their own tasks.
- A blocked run comments on the issue and stops. It does not open a broken PR.
- The retro can only *propose* changes to the agents' own instructions, via a PR you merge.

## If something looks wrong

Comment `@claude` on any issue or PR and ask. It has full context on the repo and will answer
in plain English. To stop a loop entirely: Actions tab → the workflow → `···` → Disable.
