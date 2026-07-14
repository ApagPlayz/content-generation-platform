# Tell me WHY an auto-post didn't happen

## What I did
- Before this, when a hands-off ("auto") channel finished a video but **couldn't post
  it** — YouTube not connected, the daily upload limit reached, or YouTube rejected the
  upload — the app quietly left the video sitting in "Approved" and said nothing. You'd
  only notice "my channel stopped posting" days later, with no clue why.
- Now the reason is **recorded and shown in plain English** on the dashboard. On the
  **Overview** tab, any video that couldn't post shows a short red note right under it,
  e.g. *"Not posted — YouTube isn't connected. Connect it in Settings, then publish from
  the Review inbox."* The same reason also appears on the **Queue** tab.
- The note **clears itself** automatically once the video actually posts — nothing for
  you to tidy up.
- No change to how videos are made or when they post; this only adds the missing
  explanation. Added an automated test so the wording stays correct.

## What I recommend next
- **Merge it** — it's small and self-contained (2 files touched, 1 new helper + its test).
- After merging, the two most common reasons you'll see are "YouTube isn't connected" and
  "daily upload limit reached" — both are fixed in **Settings**.
- A natural follow-up (separate issue #26) is making the **spending cap** actually stop
  spending — same spirit of "the app should tell you / protect you," bigger job.
