# Tell me when my paid voice quietly breaks (2026-07-18)

## What I did
- Fixed a silent failure: if you pick a **paid** premium voice (ElevenLabs or OpenAI) and it stops working — an expired key, out of credits, or the service rate-limiting you — the app used to quietly swap in the free robot voice and **never tell you**. You kept paying for a voice you weren't getting, and videos shipped in the wrong voice.
- Now, when a paid voice you've set up actually fails, the app:
  - Writes a plain-English note on that video's queue row, e.g. *"Your paid ElevenLabs voice didn't work this time (the API key looks expired or invalid), so this video was narrated with the free 'kokoro' voice instead… check your ElevenLabs account."*
  - **Holds that video for review** instead of auto-publishing it in the wrong voice — same safety behaviour the app already uses when a video comes out silent.
- Important: this only fires for a **real failure of a voice you configured**. If you never set up a paid voice (no key), nothing changes and you get no false alarm — the free voice was always the plan.
- Works for both true-crime and history videos (they share the same voice step).
- Tests and the app build all pass.

## What I recommend next
- **Review and merge the pull request** when you get a moment — it's a low-risk safety/trust fix, no new setup required.
- To see it without a real outage: the change is covered by automated tests, but if you want to watch it live you'd temporarily set a bad ElevenLabs key and run one video — it will land in **Review** with the warning note instead of publishing.
- Possible follow-up: an optional setting to *notify but still publish* (for owners who'd rather ship the backup voice than hold the video). I left that out to keep this change small and safe by default.
