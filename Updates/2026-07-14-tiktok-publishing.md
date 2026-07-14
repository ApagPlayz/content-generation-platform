# TikTok publishing (PR #34)

## What I did
- Taught the engine to post videos to **TikTok**, not just YouTube — so the same
  finished clip can earn on two platforms for no extra work. This is the "start
  with TikTok" slice you asked for in issue #19.
- **Settings** now has a real **TikTok** card (it used to say "Coming soon"):
  paste your TikTok app key + secret and hit **Save & Connect**, exactly like the
  YouTube card works today.
- Added a separate **Auto-publish to TikTok** switch — off by default, and
  independent of the YouTube switch. When both are on, one approved video posts
  to YouTube *and* TikTok automatically.
- Nothing about YouTube changed. If TikTok isn't set up, it's silently skipped —
  no scary red "didn't post" for a platform you haven't connected.
- Opened **PR #34**, assigned to you, and it closes issue #19. Build + all 185
  tests pass.

## What I recommend next
- **Review & merge PR #34** when you're ready (about a 2-minute read on your phone).
- To actually go live on TikTok you'll need to create a TikTok developer app and
  get it approved for posting — the same one-time step YouTube needed with Google
  Cloud. The Settings card shows the redirect URL to use. Until approval, TikTok
  posts default to **private**, so nothing can go public by accident.
- **Left for a follow-up** (say the word and I'll build them): Instagram Reels,
  and TikTok view/revenue numbers on the dashboard.
