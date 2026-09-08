# Put your links & call-to-action on every video (Issue #27)

## What I did
- Added a **"Links / call-to-action"** box to the New Factory screen. Whatever you
  type there (affiliate links, "subscribe for more", your shop) is now automatically
  added to the end of **every** video that factory publishes to YouTube.
- The description already gets generated for each video — we just never attached the
  money part. Now we do.
- On the Factories dashboard, a small blue **🔗 links** tag appears on any factory
  that has a call-to-action set, so you can tell at a glance which ones are earning-ready
  (hover it to see the exact text).
- If a factory has no links set, its videos publish exactly as before — nothing changes,
  no surprise text.
- Wrote automated tests that prove the links land in the right spot in the description
  and that factories without links are untouched.

## Why it matters
- YouTube ad money doesn't pay a cent until the channel hits 1,000 subscribers +
  10M short views. **Affiliate links and CTAs earn from the very first view** — no
  threshold. This lets the channel start making money now instead of waiting months.

## How to check it works — click by click
1. Open the app (`npm run go`), go to **Factories → New Factory**.
2. Pick a type, give it a name, and in the new **"Links / call-to-action"** box type
   something like `👉 Subscribe: https://youtube.com/@yourchannel`.
3. Click **Create Factory**. You land back on the Factories list.
4. On that factory's card you'll now see a blue **🔗 links** tag — hover it to see your text.
   That confirms it saved.
5. From then on, every video that factory publishes to YouTube carries that block at the
   bottom of its description.

## What could break
- Very little. The change only *adds* text to the YouTube description; it never removes
  the video, hashtags, or the required `#Shorts` tag. Existing factories with no links
  behave exactly as before.

## What I deliberately left out (good follow-ups)
- **Editing a factory's links later** — right now links are set when you create the
  factory. An edit screen is the obvious next step.
- **Pinned first comment** with the link (gets more clicks) — needs an extra YouTube
  permission.
- **Click tracking per factory** (which factory's videos actually drive clicks) — needs
  a small analytics screen.
- **TikTok** — TikTok caption links aren't clickable, so a link there has no payoff yet.
  Kept this to YouTube where the links actually work.
