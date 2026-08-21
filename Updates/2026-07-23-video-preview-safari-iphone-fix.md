# Video previews now play on Mac Safari & iPhone

**Date:** 2026-07-23
**Issue:** #70 · **Pull request:** #119

## What I did
- Fixed the video preview in your Review Inbox so it **plays and scrubs on Safari (Mac) and iPhone**. Before, Apple browsers refused to play it, so you couldn't reliably review a video before it auto-posted.
- The rest of the app is untouched — only the preview player was fixed. Chrome and Firefox keep working exactly as before.
- Added tests (the whole suite of 502 passes) and confirmed the app still builds.

## What I recommend next
- **Review and merge PR #119.** To check it yourself: run `npm run go`, open the Review Inbox in Safari on your Mac and on your iPhone, press play on a video, and drag the timeline to jump around. It should play and seek smoothly.
- After merging, the other approved items are still waiting — good candidates next: the premium-voice silent-fallback alert (#57) and the pronunciation step before voiceovers (#51).
