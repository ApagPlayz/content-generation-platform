# Put a "follow / link" call-to-action on every video

**Pull request:** #48 — https://github.com/ApagPlayz/content-generation-platform/pull/48
**Issue:** #27

## What I did
- Every video we publish now automatically gets a **"follow for more" line** added to the bottom of its description (and TikTok caption). That space used to be left empty.
- Each channel type gets its own default line (true crime, sports, Reddit, history). You can later swap in your own wording or an affiliate link per channel — no developer needed.
- Added a **"What we'll post" preview** in the Review Inbox so you can see the exact description, follow line and all, just by clicking — no YouTube account required.
- Checked it end to end: the app builds, all 230 automated tests pass.

## What I recommend next
- **Merge #48** once you've had a look — it starts every video earning-ready.
- **Two follow-ups I deliberately left out to keep this small and safe:**
  - A **pinned first comment** with your main link (pinned links get more clicks). Needs an extra YouTube sign-in permission, so it's its own change.
  - **Click tracking** — seeing which channel's links actually get clicked, so you can double down on the earners.
- When you're ready, drop your real affiliate/link text and I'll wire it into each channel's default.
