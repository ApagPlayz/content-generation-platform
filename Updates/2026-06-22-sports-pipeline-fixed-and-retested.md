# Sports factory — fixed and re-tested (it works now)

Follow-up to the earlier verification. You asked me to apply the fixes, re-run it, and show
you an example. Done — the Sports factory now produces a finished video end-to-end.

## What I did

- **Updated the downloader** (`yt-dlp`, was 3+ months old → latest). This cleared the YouTube
  "403 Forbidden" blocks that were stopping downloads.
- **Stopped it grabbing whole reels.** It now downloads just a ~90-second slice and cuts the
  highlight from that, instead of pulling the entire 15-minute reel. Result: the download went
  from 290MB+ (and timing out) down to **37MB**, and the whole job finished in about **3.5
  minutes**. (This window is adjustable later if we want.)
- **Re-ran the full Sports pipeline** — all five steps passed:
  - Picked an idea → searched YouTube → downloaded the slice → found the loudest 20-second
    moment (43s–63s in) → wrote the title/caption → rendered the final vertical video.
- **The example it made:** a real NBA highlight (Orlando Magic vs OKC Thunder), cropped to
  phone-shape (9:16, 1080×1920), 20 seconds, with sound.
  - Video: `sports-example.mp4` (in the project's main folder — double-click to watch)
  - Still image: `sports-example-frame.png`
  - Title it generated: *"NBA highlights you need to see"*
  - Hashtags: #nba #basketball #edit #highlights #fyp

## Where the videos come from

It searches **YouTube** and downloads the top result. For this run it used the offline
"trending audio" idea, whose search is fixed to *"NBA best dunks and game winners
compilation"* — so it pulled the #1 YouTube hit for that. The two smarter strategies (picking
a specific exciting game, or a star player's career reel) build better searches from live NBA
data, but those need the free NBA stats key added before they'll run. **Worth knowing:** the
clips are other people's YouTube uploads — fine for testing, but reusing them for real posting
has copyright considerations we should talk through before publishing.

## What I recommend next

1. **One thing still missing: the on-screen caption.** This Mac's basic video tool can't draw
   text, so the clip currently has no text overlay. The fix is to switch Sports to the
   "Remotion" render engine you already built for True Crime (nicer animated captions anyway).
   Small change — I can do it next.
2. **Add the free NBA stats key** so it can make *specific game* and *player* highlights, not
   just the generic "compilation" search.
3. **Talk through the copyright angle** before any real publishing of YouTube-sourced clips.
4. After that, the bigger upgrades from before still stand: voiceover, more leagues, and the
   self-improving loop.
