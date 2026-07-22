# TikTok captions no longer copy your YouTube post (anti-shadowban) — 2026-07-22

## What I did
- When a video auto-posts to **TikTok**, its caption is now written fresh for TikTok
  instead of reusing the exact YouTube wording.
- Each TikTok caption now:
  - **opens with a short, natural hook** (e.g. "Here's the story 👇") that varies
    from video to video, so your posts don't all read identically like a bot,
  - **always adds a TikTok-native tag** (`#fyp` / `#foryou` / `#foryoupage`) that a
    YouTube description never carries, and
  - is **guaranteed to never be word-for-word identical** to what went to YouTube.
- Why this matters: TikTok's single biggest shadowban trigger is metadata that
  "matches an existing video." Copying the YouTube title/description straight onto
  TikTok is exactly that. This closes the hole.
- Added tests that prove the caption is always different from the YouTube text,
  varies per video, and stays within TikTok's length limit. All 275 tests pass;
  the app builds cleanly.

## What I recommend next
The issue (#88) had two more parts I deliberately left for separate, small PRs so
this one stays easy to review and safe to merge:
1. **Staggered posting times** — nudge each post's time by a few minutes so they
   don't all fire at the same robotic minute.
2. **"Your reach just died" alert** — warn you on the dashboard if views suddenly
   collapse across recent posts. (This one first needs TikTok view numbers to be
   pulled in, which the app doesn't do yet.)

Tell me which to pick up next and I'll open a follow-up.
