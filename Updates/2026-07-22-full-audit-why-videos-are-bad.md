# 2026-07-22 — Full audit: why the videos are bad & why it repeats the same case

## What I did

Ran a 6-agent investigation across the whole project: the visuals pipeline, the topic
picker, the actual video files on disk, the full codebase, the GitHub backlog, and the
legal/safety guardrails. Everything below is verified with evidence, not guesswork.

### Why it keeps making the same case
- The app has **no memory of what it already covered** — nothing ever asks "did we do
  this case before?"
- It picks the case from the **day of the month**, so every video made on the same day
  is the same case (that's why you got "Panic of 1907" five times in one day).
- A filter that requires "enough archive footage" shrinks the list to a few favorites,
  so even different days land on the same cases.
- Hard proof: 27 videos exist, only 19 distinct scripts — 5× Wright Brothers,
  5× Panic of 1907, 5× Leopold and Loeb, 4× Standard Oil.
- The unmerged "anti-repetition" fix on GitHub (#65) does NOT fix this — it covers
  sports/reddit, not true crime/history. This needs its own new fix.

### Why the videos look terrible
- Good news: **your "no video clips, just pan through pictures" idea is already how it
  works** (since July 13). The format isn't the problem — the pictures are.
- The pictures are mostly **irrelevant** (tropical rain + a Chinese city at night used
  for a US banking-crisis video; a 1940s Lockheed ad standing in for the Wright Brothers).
- Many "pictures" are **single frames grabbed out of old films** — blurry and grainy by
  nature. Real photographs exist as a source but aren't prioritized.
- The renderer **force-crops every photo to fill the vertical screen and over-zooms** —
  faces and on-screen text get cut off. A proper fix (blurred background behind the full
  photo) already exists in an older code path but isn't wired into the active renderer.
- Pictures are fetched small and blown up ~2.7×, adding blur. One-line fix.
- The same few images are recycled across videos (one image appears in 11 videos).

### Why the scripts sound broken
- The History factory was created by **copy-pasting the True Crime factory's settings**,
  so history videos are literally instructed to frame stories as "courtroom" or
  "forensics" cases. That's the Wright-Brothers-courtroom nonsense, and it affects every
  history video.
- A fill-in-the-blank sentence template jams a raw keyword into prose → guaranteed
  broken grammar ("This courtroom sticks to what the public record documents").
- One video repeats the identical sentence three times in a row; sports videos have
  almost no script at all ("Wait for the drop 👀").

### The bigger picture: fixes exist but never shipped
- 18 finished fixes sit unmerged on GitHub, several aimed exactly at these complaints:
  narration-cut-off fix (#95), background music (#55), redesign options (#52),
  learn-from-winners (#46). None reach the app until merged.
- 3 of them have gone stale and need repair before they can merge (incl. anti-repetition #65).

### Safety audit (important)
- The legal guardrails are well-designed in the middle but leaky at the edges. Three
  serious gaps found, worst being: the defamation check only matches exact full names
  (fix exists in unmerged PR #47), the publish button ignores whether a video was
  rejected, and the "AI content" disclosure flag is computed but never sent to YouTube.
- Autoposting is still OFF everywhere, so nothing has actually gone out — but these
  should be fixed before it's ever turned on.

## What I recommend next

1. **Direct fixes I can make today** (small, high-impact):
   - Remember covered cases + rotate properly → no more repeats.
   - Fix the photo cropping (blurred background, no more cut-off faces).
   - Photos-only sourcing + fetch larger images → sharper, relevant pictures.
   - Fix the copy-pasted history settings + the broken sentence template.
2. **Merge the ready GitHub fixes**: #95 (narration cut-off), #55 (music), #52
   (redesigns), #46 (learn from winners).
3. **Before autoposting is ever enabled**: merge defamation fix #47 and add the two
   publish-safety checks.
4. Optional upgrade later: AI-generated custom images per scene (needs a paid API key).
