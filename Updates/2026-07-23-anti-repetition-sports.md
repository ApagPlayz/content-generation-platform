# Sports videos now get the anti-repetition safety brake (Issue #17)

## What I did
- Your app already had a check that stops it from publishing near-identical
  videos — the thing that protects a channel from YouTube's "mass-produced /
  inauthentic content" crackdown. It only ran on **True Crime** and **History**.
- **Sports had none of it.** It could repeat the same hook, structure, and even
  the same broadcast clip with nothing stopping it — and Sports is the factory
  most likely to repeat itself.
- I turned that same brake on for **Sports**. Before a sports video publishes, the
  app now compares it to your recent sports videos on the spoken hook/commentary,
  the shape of the video, and the source clip. Too similar → it's **held in your
  Review inbox** instead of auto-publishing.
- It only ever *holds for review* on repetition — it never hard-rejects a sports
  video for that alone, and your first few sports videos always pass (nothing to
  compare against yet).
- Opened **PR #112** for you to review. Everything passed: 24 new checks, the full
  test suite (490), the code linter, and the production build.

## What I recommend next
- **Review and merge PR #112** when you have two minutes — the description walks you
  through how to see it working.
- **Optional fast-follow:** right now it *flags* repeats for you. A natural next step
  is having it *auto-vary* the hook/template so fewer videos need your review at all.
  Say the word and I can propose that as a follow-up.
- Note: "Reddit" isn't a separate pipeline in the code today — anything that isn't
  True Crime or History runs through the Sports pipeline, so covering Sports covered
  it too.
