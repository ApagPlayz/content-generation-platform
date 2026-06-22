# The launcher now starts everything for you — including Docker — 2026-06-18

## What I did
- **Made the "Content Engine" launcher start the free voice engine automatically.** When
  you open the launcher (or run the app), it now:
  1. Opens Docker Desktop for you if it isn't already running.
  2. Waits for it to finish booting, then makes sure the Kokoro voice container is on.
  3. Starts the app and opens it in your browser.
- **You no longer have to remember to open Docker after a reboot.** Just open the Content
  Engine launcher and everything you need comes up on its own.
- **It's built to never get stuck.** If Docker is slow, missing, or has a hiccup, the app
  still opens and simply uses the basic backup voice until the natural voice is ready —
  it won't hang or fail to launch. It also tells you on screen what it's waiting for.
- **Light on your Mac:** Docker only starts when you actually open the launcher — not every
  time you turn the Mac on — so it won't quietly eat memory in the background when you're
  not making videos.

## What I recommend next
- **Let me do a live test:** I can open the launcher now so we can watch it boot Docker, the
  voice engine, and the app together — that confirms it works on your actual setup. (It will
  open Docker Desktop and a browser window.) Just say the word.
- **After that, make one video** to hear the natural voice come through with the new,
  better-synced captions from earlier today.
