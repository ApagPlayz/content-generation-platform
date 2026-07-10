# Phase 2 built: real-footage ladder + quality boosts

## What I did

- **Turned the whole sourcing-strategy report into working code.** A fleet of agents
  researched the codebase, planned every piece, then built it in 4 checked waves — all on
  a separate branch (`feat/phase2-footage-ladder`) so your existing work is untouched and
  this is easy to review or undo.

- **Built the "footage ladder" for True Crime** — instead of one source, it tries several
  in order and uses the best it can get, per beat of the story:
  1. **AI still image + slow "Ken Burns" zoom** (the real true-crime look)
  2. **Pexels / Pixabay** stock clips
  3. **archive.org** public-domain footage (**needs no key**)
  4. **Local "mood bank"** of atmospheric clips
  5. Existing Wikimedia image as a safe last resort

- **Added the quality boosts and the sports upgrade too:**
  - Optional **AI script writer** (Claude Sonnet 5), behind an on/off switch.
  - **Anti-repetition system** — forces each video to look/feel different from recent ones,
    your defense against YouTube's July-2025 "inauthentic content" crackdown.
  - **Sports transformation layer** — commentary/edit treatment + steers toward
    claim-tolerant leagues (favor NBA; flags NFL/UFC to review).
  - A **database table** that remembers downloaded clips (caching + honest licensing).

- **Everything is OFF by default and safe with no keys.** The app runs exactly as before
  until you switch a feature on. Nothing auto-publishes on its own.

- **I checked it hard before calling it done:**
  - Compiles cleanly + passes the full production build.
  - **Compliance review: SAFE** — no way for an unsourced, unlicensed, or fake-AI-face
    visual to slip past the legal gate that previously blocked it.
  - **Correctness review** found a few "when you turn it on" bugs — I fixed all of them
    (biggest: the footage ladder's step-names didn't match the code, so the AI-still step
    would never have fired).
  - **Actually rendered video at runtime** to prove it works — including the edge case
    where a clip fails and the system correctly makes a full-length video anyway.

## What I recommend next

- **To switch on the free stuff now (no cost):** in the True Crime factory config, set
  `footageEnabled: true` and `useArchiveFootage: true`. That gives you real public-domain
  footage + AI-style stills with zero keys.
- **To unlock stock footage:** grab two free API keys — **Pexels** and **Pixabay**
  (~2 min each, no card) — and drop them into `.env.local`. I've already left labelled
  placeholder lines there.
- **To unlock sharper scripts / real AI images:** add a **Claude** key (for the writer)
  and/or an **OpenAI or Stability** key (for AI stills). All optional.
- **Decide:** do you want me to **merge this branch** into your main line of work, or keep
  it separate while you try it? And **which genre** should I polish first with you —
  True Crime or Sports?
- One heads-up: with footage on, some archive.org clips are deliberately routed to
  "review" (not auto-published) because their copyright status isn't guaranteed — that's
  the safe behavior, not a bug.

_Branch: `feat/phase2-footage-ladder` · 13 new files, ~20 files updated · not yet committed
(say the word and I'll commit it)._
