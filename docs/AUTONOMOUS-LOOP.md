# The autonomous improvement loop

How this repo improves itself while the computer is off, and what you do from your phone.

## What runs, and when

| Loop | When | What it does |
|---|---|---|
| **Scout** | Every hour | Researches the market and the codebase. Files issues labeled `proposal`. Stops at 8 open; never writes code. |
| **Builder** | Every 30 minutes | Builds one issue and opens one pull request — but only if your review queue has room. |
| **Auditor** | Every pull request | An independent agent attacks the PR from five angles and posts a verdict before you read it. |
| **Metrics** | Daily 7am | Recomputes `LOOP-DASHBOARD.md` from what actually merged. No agent, no tokens. |
| **Retro** | Sundays 6pm | Reads the week's real outcomes and proposes fixes to the loop itself. |
| **@claude** | Whenever you type it | Comment `@claude do X` on any issue or PR and an agent picks it up. |

## The queue rule — this is the important part

The loop runs continuously and **does not wait for your approval to build**. What throttles it
is your review queue, not the clock:

- **Daytime (7am–11pm ET):** at most **3 agent pull requests** may be open and waiting on you
  at once. The Builder stands down when the queue is full. **Merge or close one, and within 30
  minutes the next one gets built.** The queue refills itself.
- **Overnight (11pm–7am ET):** the cap comes off. Work piles up while you sleep, so there's a
  stack waiting for you in the morning.

## Your job (this is the whole manual)

1. **Review PRs whenever you have five minutes.** Read the plain-English description and the
   auditor's verdict. Merge, or comment what's wrong. Every one you clear frees a slot and
   pulls the next build forward. Your comments are what the retro learns from, so say why.
2. **To steer it: label an issue `approved`.** Approved issues jump the queue and get built
   first. You never *have* to do this — the Builder picks the strongest proposal on its own —
   but it's how you say "do this one next".
3. **To ask for something specific:** comment `@claude <what you want>` on any issue or PR.
   An agent wakes up in the cloud and does it. This is your remote control, and it doesn't
   wait for any schedule.
4. **Sunday.** Skim the retro issue. It tells you whether this is working.

That's it. Everything else is automatic.

## The one number that matters

`LOOP-DASHBOARD.md` — open it in the GitHub app. **Merge rate** is the health check. If you're
merging most of what the agents build, it's working. If you're throwing most of it away, the
loop is generating noise and the retro will tell you why.

Watch for the classic failure: **PR size climbing while merge rate falls.** That means the
agents are writing more and getting it right less. It's the single best early warning that the
loop has gone bad.

## Guardrails

- Agents never push to `main` and never merge their own work. **You merge. Always.** This is the
  real guardrail — the loop builds on its own, but nothing lands without you.
- Never more than 3 PRs waiting on you during the day. The loop throttles itself to your
  review capacity instead of burying you.
- One PR per Builder run. No pile-ups from a single run.
- A blocked run comments on the issue and stops. It does not open a broken PR.
- The retro can only *propose* changes to the agents' own instructions, via a PR you merge.

## If something looks wrong

Comment `@claude` on any issue or PR and ask. It has full context on the repo and will answer
in plain English. To stop a loop entirely: Actions tab → the workflow → `···` → Disable.
