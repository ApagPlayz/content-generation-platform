# Pronunciation step before every voiceover (issue #51)

## What I did
- The AI voice was mispronouncing the exact words your channels are built on —
  it said **"fibby" for FBI**, tripped over tricky names, and read years like
  phone numbers. That one-butchered-name-in-the-first-few-seconds problem makes a
  video sound like nobody checked it.
- I added a small **"say it right" step** that runs on the script **just before
  the voice records it**, for both **True Crime** and **History** videos:
  - Acronyms are read letter-by-letter (FBI → "F B I").
  - Years/decades are read naturally ("1995" → "nineteen ninety-five").
  - Tricky names are corrected from a built-in list (Gaddafi, Versailles, Qatar…),
    and you can add your own over time.
- **Captions still look right.** The clever part: the *voice* gets the corrected
  version, but the *on-screen captions* keep the original spelling — so viewers
  **hear it right and read it right** ("FBI" stays "FBI" on screen).
- Everything is tested (47 new checks; full test suite, lint, and build all pass).
- Opened as **PR #54** for you to review and merge.

## What I recommend next
- **Merge PR #54** when you're happy, then generate a True Crime or History video
  and play it in the Review Inbox — listen for "F B I" and natural-sounding years,
  and confirm the captions still show "FBI".
- **Good fast-follows** (I left these out to keep this change small and safe):
  - A friendly Settings screen to manage the pronunciation list (today it's an
    advanced JSON setting).
  - A "confirm this pronunciation?" prompt in the Review Inbox for names the system
    doesn't recognise, so unknown names get a quick human check.
