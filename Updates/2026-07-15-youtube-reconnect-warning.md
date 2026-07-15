# YouTube "Connected" light now tells the truth (2026-07-15)

## What I did
- Fixed a silent failure: when your YouTube login quietly expires (Google does this on its own after a password change, a security reset, or months of no use), the app used to keep showing a green **"Connected"** while every auto-post failed behind the scenes — so videos stopped going out and nothing told you why.
- Now the app notices the dead login the moment a post (or the background stats refresh) hits Google's "you're logged out" error, and it says so plainly:
  - **Settings** shows an amber **"Reconnect needed"** badge with a short explanation and a **Reconnect** button — clearly different from the grey "Not connected" you'd see if you'd never set it up.
  - The **dashboard** shows a matching amber banner at the top that taps straight through to Settings.
  - The "why a video didn't post" note now reads in plain English instead of technical gibberish.
- Only Google's real "logged out" errors trigger the warning — a healthy connection is never flagged, and everyday hiccups (like hitting the daily upload cap) don't set it off.
- Opened one pull request (#40) for you to review. Tests and the app build all pass.

## What I recommend next
- **Review and merge PR #40** when you get a moment — it's a safety/trust fix with low risk.
- To see it in action without waiting for a real expiry: open the database browser (`npm run prisma:studio`), find the YouTube row in **PlatformAuth**, switch its status from `active` to `needs_reconnect`, and refresh Settings — you'll see the amber warning. Switch it back (or reconnect) to clear it. Full click-by-click steps are in the PR.
- A follow-up worth considering later: TikTok can go stale the same way, so we could give it the same "reconnect needed" warning. I left that out to keep this change small and focused.
