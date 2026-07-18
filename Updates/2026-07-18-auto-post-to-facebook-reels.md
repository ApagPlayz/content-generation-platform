# Auto-post your videos to Facebook Reels — 2026-07-18

## What I did
- Your app already posts each finished video to **YouTube** and **TikTok**. I added a
  third free destination: **Facebook Reels** — the same finished video, no re-work.
- Added a **"Facebook Reels" box in Settings** that works exactly like the YouTube and
  TikTok ones: paste your app's ID + secret, tick "Auto-publish to Facebook", and click
  **Save & Connect**. There's a green "Connected as <your Page>" pill when it's linked.
- Facebook is its **own on/off switch** — turning it on doesn't change anything about
  YouTube or TikTok, and it starts **off** until you choose to enable it.
- Nothing double-posts: if a video is already live on Facebook, re-running the pipeline
  leaves it alone (same safety the other platforms already have).
- Facebook Reels earns the **highest ad money per view** of your platforms, so this is the
  one most likely to move your revenue.

## What you need to do (one-time, ~10 minutes)
1. Go to **developers.facebook.com** and create a free app.
2. Add the **"Facebook Login"** product to it, and set the redirect address to:
   `http://localhost:3000/api/auth/meta/callback`
3. Copy the app's **App ID** and **App Secret** into the new Facebook Reels box in Settings.
4. Make sure the account you connect **manages a Facebook Page** — Reels post to a Page,
   not a personal profile.
5. Click **Save & Connect**, approve the pop-up, then tick **Auto-publish to Facebook**.

Note: until Meta reviews your app it can still post to **your own** Page — which is all a
single-user setup needs. No review is required to get going.

## What I recommend next
- After connecting, generate one video with an auto agent and confirm it shows up on your
  Page's Reels and as a "published" row in the dashboard.
- **Instagram Reels is the natural follow-up.** I deliberately left it out of this change:
  Instagram's API won't accept a file off your computer — it insists on a **public web link**
  to the video first, which this local app doesn't have yet. Adding Instagram means adding a
  small "put the video somewhere public" step. Say the word and I'll scope that next.
