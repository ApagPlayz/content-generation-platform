# Added Claude Code automations to the project

_2026-06-18_

## What I did
- **Two automatic safety checks** now run while Claude works on this project:
  - It is blocked from editing the `.env` secret files (your YouTube login keys) — those stay hand-edited only.
  - After Claude changes any code file, it auto-checks that the code still compiles and is clean, and fixes problems on the spot.
- **Two specialist reviewers** Claude can now call:
  - A **compliance reviewer** that guards the True Crime legal rules (sourcing, defamation, "innocent until proven guilty") so a risky claim can't slip into a published video.
  - A **code reviewer** focused on the YouTube publishing and pipeline code (we have no automated tests yet, so this is the safety net).
- **Two shortcuts** ("skills"):
  - `new-factory` — scaffolds a brand-new content format (e.g. music reviews, streamer clips) following your existing Sports/True Crime pattern.
  - `owner-update` — writes these plain-language summaries consistently.
- **GitHub connection** config added so Claude can work with issues and pull requests directly. This one needs a one-time token from you to switch on.

## What I recommend next
- **Turn on the GitHub connection:** create a GitHub personal access token and add it as `GITHUB_PERSONAL_ACCESS_TOKEN`, then restart. I can walk you through it in 2 minutes.
- **Add a small test suite:** you currently have zero automated tests on code that publishes to YouTube and makes legal calls. I'd start with tests for the compliance gate and the publish/quota logic — it makes all the new reviewers and checks much stronger. Say the word and I'll set it up.
- The two automatic checks run on every code edit; if they ever feel slow or noisy, I can dial them back to lint-only.
