# Sports factory — does it actually work? (verification)

You asked what's next for the Sports factory and chose "verify it works first." I ran the
real pipeline end-to-end and tested each step. Here's the honest result.

## What I did

- **Ran a real Sports video job** through the live app (find clip → cut highlight → render).
- **Step 1 — Picking what to make: WORKS.** It correctly fell back to its offline "trending
  audio" idea when the NBA stats key wasn't set, and produced a real search.
- **Step 2 — Downloading the clip from YouTube: BROKEN right now.** Two real problems:
  - YouTube blocked the download with a "403 Forbidden" error. The cause: the downloader
    tool (`yt-dlp`) on this Mac is **over 3 months old**, and YouTube routinely blocks old
    versions. This is the main thing stopping Sports from working today.
  - Even when it does download, it grabs the **entire** highlight reel (hundreds of MB, 15+
    minutes) just to keep a 20-second cut. It timed out, then retried from scratch — and
    each retry even picked a *different* video. Slow and wasteful.
- **Step 3 — Finding the exciting moment: WORKS.** I tested it on a clip with a loud burst
  in the middle; it correctly locked onto that exact moment.
- **Step 4 — Writing the title/caption: WORKS** (uses simple templates when no AI key is set).
- **Step 5 — Rendering the final video: WORKS.** It produced a proper phone-shaped
  (9:16, 1080×1920) 20-second video. *But:* this Mac's video tool can't burn text on screen,
  so the on-screen caption is silently skipped — Sports clips come out with **no text overlay**
  unless we switch to the fancier "Remotion" render engine.

**Bottom line:** the Sports factory is wired up correctly and 4 of its 5 steps work. The one
broken step — downloading the clip — is what's blocking a full run today, and it's fixable.

## What I recommend next

1. **Update the downloader (quick win, ~1 min).** Refresh `yt-dlp` to the latest version. This
   alone likely clears the YouTube "403" blocks. I can do this for you.
2. **Download only the slice we need, not the whole reel.** Make Step 2 grab ~60 seconds
   instead of the full video. Much faster, far fewer timeouts/failures.
3. **Decide how captions should look.** This Mac's basic video tool can't draw text, so either
   (a) switch Sports to the "Remotion" engine you already built for True Crime (nicer animated
   captions), or (b) install text support for the basic tool. I'd lean toward (a).
4. **Then re-run a clean end-to-end test** to confirm a finished Sports video with captions.

If you want, I can do #1 and #2 now and re-test — that would get Sports producing real videos
again. After that we can revisit adding voiceover, more leagues, or the self-improving loop.
