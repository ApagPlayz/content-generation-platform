# Tell you WHY a video didn't post

**PR:** https://github.com/ApagPlayz/content-generation-platform/pull/28 · Closes issue #15

## What I did
- When a hands-off ("auto") agent makes a video but **can't post it to YouTube**, the app used to leave it stuck in "Approved" and say nothing — you'd only notice days later that the channel had gone quiet.
- Now the dashboard shows a small red line under that video explaining **why**, in plain English, e.g. *"Not posted: YouTube not connected"* or *"Not posted: daily upload quota reached (6/day)."*
- The app was already figuring out the reason — it was just being thrown away. This puts it on the screen.
- It stays **quiet when it should**: if you simply switched auto-posting off, or an agent is in "review" mode on purpose, no warning appears — those are your choices, not failures.
- Small, low-risk change: it only *adds* a message. It doesn't change how videos are made or how posting works, and there's nothing new to set up.

## What I recommend next
- **Have a quick look and merge** if it reads well: open the PR on your phone (it's written to skim in ~2 minutes) and check it off. It's already assigned to you.
- **To see it live:** run the app, keep YouTube disconnected, let an auto agent finish a video, and look at the front page (Recent Activity) — the new red "Not posted" line should be there.
- **Possible follow-ups** (separate, optional): a matching note on each agent's own page, and email/notification alerts when posting stalls — I left these out to keep this change small.
