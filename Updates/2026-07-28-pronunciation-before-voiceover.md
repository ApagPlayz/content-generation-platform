# Stop the voice mispronouncing names & acronyms

## What I did

- Added a **"say it right" step** that runs on the script **just before the voice records it**.
  It applies to every video the app makes — True Crime, History, and anything added later —
  because all of them share the same voice step.
- **Acronyms** are now read letter by letter: the voice says **"F B I"**, not "fibby".
- **Years and decades** are read naturally: 1995 → "nineteen ninety-five", the 1980s →
  "the nineteen eighties", 2001 → "two thousand one".
- **Tricky names** are corrected from a built-in list (Gaddafi, Versailles, Worcester,
  Antetokounmpo, Nietzsche and about 35 more across your four niches).
- **You can add your own** names in Settings — there's a new box under the voice provider:
  *"How to say tricky names."*
- **The captions still look right.** This was the fiddly part: fixing the audio would
  normally also make the on-screen text say "F B I". The code keeps the *original spelling*
  for what's on screen while the *voice* gets the corrected version. Hear it right, read it right.
- Everything is covered by 24 new tests. Lint, the full test suite (559 tests) and the
  production build are all green.

## What I recommend next

- **Try it on one video.** Generate a True Crime or History video whose script has an
  acronym and a date, then play it in the Review Inbox — the voice should say "F B I" and
  read the year naturally, while the captions still show "FBI" and the digits.
- **Add names as you hear them go wrong.** When you catch a mispronunciation, drop it into
  the Settings box. That list is the thing that gets better over time.
- **Two things I deliberately left for later**, to keep this change small and safe:
  - The optional *"confirm pronunciation of 'Gaddafi'?"* prompt in the Review Inbox — it
    needs new screen design, and it's only useful once you can hear the name before approving.
  - Multi-word entries (e.g. treating "Ada Lovelace" as one phrase). Single names work today.
