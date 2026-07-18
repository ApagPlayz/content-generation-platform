# TikTok now warns you when its login expires (issue #56)

## What I did
- Your TikTok connection used to go dark **silently**: when its login expired or
  was revoked, videos just stopped posting to TikTok while Settings kept showing a
  green "Connected." You'd have no idea one of your two channels had stopped.
- I gave TikTok the **exact same safety net YouTube already has**. When the login
  goes stale, the app now:
  - flips TikTok to an amber **"Reconnect needed"** badge in Settings,
  - shows a short plain-English banner explaining what happened and what to do,
  - turns the button amber and labels it **"Reconnect,"**
  - records the reason on the affected video in plain words (not techie jargon).
- Added tests so this behaviour can't quietly regress, and confirmed the app still
  builds and all 225 tests pass.

## What I recommend next
- **Merge the PR** if it looks good — it's a small, self-contained change.
- Quick way to see it working: open **Settings** and look at the TikTok card. When
  a login is healthy it stays green; when it expires you'll now get the amber
  "Reconnect needed" warning instead of a false "Connected."
- Optional follow-up (not in this PR, to keep it small): show the same amber
  warning on the **dashboard home page** for TikTok, the way YouTube already does.
  Say the word and I'll add it.
