# Stop TikTok seeing your videos as "reused" — different caption than YouTube

## What I did
- When the app posts a video to **both YouTube and TikTok**, TikTok used to get the
  **exact same title and hashtags** YouTube got. TikTok treats matching metadata as
  "unoriginal content" — one of the top reasons it quietly throttles (shadowbans) an
  account for 2–4 weeks with no warning.
- Now every TikTok post gets its **own caption**: a short, natural human opener on the
  front (e.g. *"The part most people skip:"*) plus **TikTok-native tags** like `#fyp`
  and `#foryou` that YouTube never uses. So a TikTok post is **never** byte-for-byte
  the same as the YouTube one.
- The opener is chosen per-video and is **safe for true-crime** — none of them ever
  implies anyone is guilty (there's a test locking that in).
- Nothing about how videos are made, reviewed, or when they post changes — only the
  words TikTok receives.

## What I recommend next
- These were the two other pieces of the same idea, deliberately left for follow-up PRs
  to keep this one small and safe:
  1. **Staggered / human-looking posting times** for TikTok (instead of identical drops).
  2. A **"your reach just died" alert** if TikTok views suddenly collapse across posts.
- Both are good next steps once this lands.
