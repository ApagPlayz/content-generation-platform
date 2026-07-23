# Fixed the "two-picture" video problem (image sourcing overhaul)

## What I did
- **Found why the South Sea Bubble video was so bad.** The archive.org "photos only"
  setting returns essentially nothing for old (pre-photo) topics, so the app fell back
  to a single Wikipedia search that returned just two pictures — one of them a tiny
  6.7 KB stock chart with Japanese labels. Nothing in the pipeline objected, so it
  rendered two images each held for ~30 seconds.
- **Made image sourcing much deeper.** The app now pulls pictures from three places:
  the topic's own Wikipedia article (its images are always on-topic — Hogarth engravings,
  the famous "Change Alley" painting, share certificates), plus multiple smart searches
  built from the story's key people/places, plus archive.org where it actually has photos.
- **Added a quality floor.** Any picture that's too small (under ~600px or under 50 KB)
  or that looks like a chart, graph, diagram, logo, icon, seal, coat of arms, or map is
  now rejected before it's ever downloaded. The 6.7 KB Japanese chart is now impossible.
- **Added a hard safety stop.** If fewer than 5 good pictures can be found for a topic,
  the run now **fails on purpose** with a clear message instead of shipping a starved
  slideshow. Better no video than an embarrassing one.
- **Proved it end-to-end.** Re-ran the History factory. It produced a real "South Sea
  Bubble" video with **6 distinct, high-quality period images** (paintings, engravings,
  genuine 1720 share documents, a satirical print) spread evenly across the runtime —
  no more 30-second holds. I looked at the actual video frames to confirm.
- All 384 automated tests pass and the code type-checks cleanly. The live app has been
  rebuilt and restarted with the fix.

## What I recommend next
- **Give it a watch.** The next History and True Crime videos should look dramatically
  better. Take a look and tell me if the picture relevance feels right.
- **One thing to know:** Wikipedia/Wikimedia occasionally rate-limits when many videos
  are made back-to-back in a short window (I hit this while stress-testing). When that
  happens a run will safely fail rather than make a bad video, and the next run recovers.
  If you ever see a run fail with "not rendering a starved slideshow," just re-run it. If
  it becomes common in normal use, I can add a gentle auto-retry — say the word.
- No settings needed changing — the fix is entirely in the app's logic, and the
  "photos only, no blurry film frames" preference is preserved.
