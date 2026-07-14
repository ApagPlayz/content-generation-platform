# Tell the owner *why* an auto-post didn't happen

## What I did
- Before, when a hands-off ("auto") agent finished a video but couldn't post it —
  YouTube not connected, the daily upload limit used up, or YouTube rejecting the
  upload — the video quietly sat in "approved" and nothing told you why. You'd only
  notice the channel had gone quiet days later.
- Now the app **records the reason** every time an auto-post is blocked, and shows it
  on the dashboard's **Recent Activity** list as a red **"Not posted"** tag with a
  plain-English line underneath, for example:
  - "Not posted — YouTube isn't connected. Connect it in Settings to publish."
  - "Not posted — YouTube's daily upload limit was reached. It'll retry on the next run."
  - "Not posted — YouTube rejected the upload: …" (shows the exact reason for anything else).
- The fix sits in one shared place, so it works for all three video types (sports,
  true crime, history) at once.
- Added an automated test for the plain-English messages, and checked the whole app
  still builds and all 166 tests pass.

## What I recommend next
- **Try it:** disconnect YouTube (or let the daily limit fill up) and let an auto
  agent run — the video will now show a clear "Not posted, here's why" instead of
  going silent.
- **Optional later:** send these notices somewhere you'll see them without opening the
  dashboard (email or a phone notification), and add a one-click "retry now" button.
