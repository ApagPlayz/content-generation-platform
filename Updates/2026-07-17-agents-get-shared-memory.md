# Your AI helpers are getting a shared memory (one quick permission needed)

## What I did
- Set up a **shared long-term memory** for your automated helpers (the Scout, Builder,
  Auditor, Retro, Redraft, Demo, and the @claude phone assistant).
- Today each helper wakes up with a blank slate every single time. With this, they all
  read from and write to one shared "notebook" that survives between runs — so they can
  remember things like *which ideas you approved, which you keep rejecting, and which parts
  of the app tend to break*. Less repetition, fewer re-suggested ideas.
- It's a free, local tool — **no account and no API key to buy.**
- I tested the memory tool itself and it works: it starts correctly, and I proved that
  something one run writes down is still there when a different run reads it back later.

## The one thing I need from you
- GitHub blocked me from finishing the wiring because editing the helpers' setup files
  requires a permission the automation isn't allowed to use on its own — a safety rule on
  GitHub's side, not a bug.
- I opened a short **"🔑 Action needed"** issue with numbered, plain-English steps (about a
  2-minute job in your repo settings). Once you do that one step, the memory switches on for
  every helper. Everything else is already prepared and waiting.

## What I recommend next
- **Do the 2-minute step in the "🔑 Action needed" issue**, then merge the pull request I
  opened (it's assigned to you).
- One honest limitation: the shared memory is carried between runs by GitHub's temporary
  storage, which GitHub clears if it's unused for about a week or gets full. So treat it as a
  helpful scratchpad, **not** a permanent record — your GitHub issues and pull requests are
  still the real source of truth.
