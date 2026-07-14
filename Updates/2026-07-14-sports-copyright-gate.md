# Sports copyright gate — built

## What I did
- Built a **copyright-risk gate** that now runs on every sports video, right after
  it renders and **before it can post**. Nothing can slip out unchecked anymore.
- It **fails closed**: by default our sports clips come from someone else's
  broadcast with no license logged, so every one of them is now **held in your
  Review inbox** instead of auto-posting. That's the whole point — this is the
  #1 way faceless sports channels get deleted by copyright strikes.
- It scores each clip on a **transformation checklist** — did we add our own
  commentary, reframe it to vertical, add zoom/graphics, and keep it short? A
  plain cropped re-upload fails the checklist and gets flagged.
- It also flags **strike-happy leagues** (NFL, UFC) and **borrowed background
  music** as high risk — these are the biggest strike triggers.
- Your **Review inbox now shows the verdict with plain chips**: "Copyright risk:
  High/Medium/Low", whether the transformation checklist passed, and why — so a
  risky video is flagged *before* it goes out, not after a strike lands.
- Reused the exact license check we already built for the True Crime side, so
  this is consistent across the app. Added tests; everything passes.

## What I recommend next
- **Try it:** run the app, let a sports agent make a video, and open the Review
  inbox — you'll see the new copyright chips. Approve/reject as normal.
- **To let a clean sports video auto-post** (optional): in the factory config you
  can log a real source license (`sourceLicense` + `sourceLicenseRef`) and run a
  tolerant league like the NBA with the transform edit on. Otherwise everything
  safely waits for your approval.
- **Fast follow (from the earlier research):** the "golden set" check — a small
  saved set of clips you've labelled good/bad — so we can prove the gate keeps
  agreeing with your judgement over time. Say the word and I'll build it.
- **Honest limit:** we can't run YouTube's real copyright scanner locally
  (nobody outside YouTube can). This is smart rules + a fail-closed gate; it
  slashes strike risk but can't promise zero.
