# 2026-07-22 — Audit fixes shipped & proven

## What I did
- Merged 4 waiting GitHub fixes into the app: narration cut-off stop, background
  music, redesign drafts, learn-from-winners.
- Built, tested, and merged the audit fixes (PR #104):
  - The app now remembers covered cases and rotates properly — no more same-case repeats.
  - Pictures: real photographs only, shown whole over a soft blurred backdrop
    (no more chopped faces), fetched at higher resolution.
  - Scripts: history videos no longer framed as courtroom cases; broken
    fill-in-the-blank sentence replaced; no repeated sentences. Applied to the
    live factories, not just fresh installs.
  - Safety: only approved videos can ever publish; AI-content label now sent to
    YouTube; rejected videos can't be resurrected; broken checks route to review
    instead of silently passing.
- 364 tests pass, clean build, app restarted.
- Generated a proof video: "The South Sea Bubble" — new case, on-topic period
  painting + share-price chart, nothing cropped, coherent script. In the review inbox.

## What I recommend next
- Owner: watch the South Sea Bubble video and confirm the direction.
- Optional upgrade: AI-generated custom images per scene (needs a paid API key) —
  say the word and I'll research cost/options.
- Backlog triage another day: ~14 open PRs + ~30 proposals still waiting.
