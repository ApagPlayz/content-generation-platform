# Winners leaderboard now updates on its own

## What I did
- Your **Winners** leaderboard and view/like/comment numbers used to only update
  when you personally opened the page and clicked **"Refresh metrics."** Now the app
  refreshes them by itself, in the background, about **once an hour** — no click needed.
- I added a small **"Updated …"** note next to the Refresh button (e.g. "Updated 12m ago")
  so you can see at a glance how fresh the numbers are.
- The **"Refresh metrics" button still works** exactly as before if you ever want the
  very latest numbers right now.
- To keep things safe I capped the automatic refresh at once per hour (so it never
  overuses your YouTube quota), and if your YouTube login has lapsed the background
  refresh quietly backs off instead of retrying constantly.

## What I recommend next
- **How to check it works:** open the Winners page, connect YouTube if you haven't, and
  publish a video. Without touching anything, within the hour the numbers fill in on their
  own and the "Updated …" note shows a recent time. Clicking "Refresh metrics" should flip
  it to "Updated just now."
- This is the "watches what wins" half of the autonomous channel finally running unattended.
  A natural follow-on is to have the system *act* on those fresh numbers automatically
  (favouring the niches that earn) — that's issue #43, already approved and in progress.
