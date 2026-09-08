# Auto-post your videos to Facebook Reels

## What I did

- Your app already posts every finished video to **YouTube** and **TikTok**. I added a
  third free destination — **Facebook Reels** — for that *same* video. Nothing about how
  videos are made changes; we just send the file you already produced to one more place.
- There's a new **"Facebook Reels" box in Settings**, built to look and work exactly like
  the YouTube and TikTok ones: paste your App ID + App Secret, hit **Save & Connect**, and
  you get a green **"Connected as *your Page*"** pill.
- It has its own **on/off switch** ("Auto-publish to Facebook Reels"), **off by default**.
  Turning it on doesn't touch YouTube or TikTok — each platform is independent.
- **No double-posting:** if a video is already live on Facebook, re-running the pipeline
  leaves it alone (same safety the other platforms have).
- **Instagram is not included yet, on purpose.** Instagram's system refuses a file from
  your computer — it demands a public web link to the video first, which this local app
  can't provide. Facebook Reels accepts the file directly, so it ships now. The Facebook
  login I built is the same one Instagram will reuse later, so adding Instagram is an
  add-on, not a redo. The Settings screen shows Instagram as "Coming soon" with that note.

## One-time setup (about 10 minutes, only when you're ready)

1. Start the app (`npm run go`) and open **Settings** → scroll to the new **Facebook Reels**
   box. It should say **"Not connected."**
2. Go to **developers.facebook.com**, create a free app, and add the **Facebook Login**
   product to it.
3. Set the app's redirect URI to:
   `http://localhost:3000/api/auth/facebook/callback`
4. Copy the app's **App ID** and **App Secret** into the box in Settings.
5. Tick **Auto-publish to Facebook Reels**, click **Save & Connect**, and approve the pop-up.
   The box should flip to a green **"Connected as *your Page*"** pill.
   - Important: the account you connect must **manage a Facebook Page**. Reels post to a
     Page, not a personal profile. If you manage no Page, the app shows a plain-English
     message asking you to create one first.
6. Generate a video with an **auto** agent. It should appear on your Page's Reels and show a
   **"published"** row in the dashboard.

Until you connect it, nothing changes — the rest of the app is completely unaffected.

## What I recommend next

- **Do the 10-minute setup above when you have a Facebook Page ready.** Facebook Reels pays
  the highest ad money per view of your platforms, so this is the cheapest revenue bump on
  content you've already made.
- **Leave the switch off until you've connected and tested once** — flip it on only when
  you're happy the first reel posted correctly.
- **Instagram later:** when you want it, it's a smaller follow-up (the Facebook login is
  already done); it just needs a step to host each video at a public link first.
