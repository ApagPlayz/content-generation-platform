# Testing-tools research: what should watch the app for us (Chrome extension ruled out)

_2026-07-12_

## What I did
- You said no to the Chrome extension, so I ran a large fact-checked research pass
  (100 research agents, every claim verified against live sources today) on the best
  tools that let Claude open the app, click around, take screenshots, read error
  messages, and confirm a change really works.
- Good news first: the tool we ALREADY have installed (Playwright) came out as the
  clear #1. It's what most Claude developers use for exactly this "change something →
  prove it works" loop. Nothing to install, nothing to pay.
- Ranked list (best to worst):
  1. **Playwright (already installed)** — keep as the main driver. Clicks, types,
     screenshots, reads the page like a checklist. Free, made by Microsoft, actively updated.
  2. **Chrome DevTools tool (by Google)** — the one worthwhile ADD-ON. When something
     breaks, it shows the exact error messages and the exact failed network request
     instead of guessing from a screenshot. Free, no account or key needed, one-line
     install. Experts recommend running it alongside Playwright: "Playwright drives,
     DevTools debugs."
  3. **Peekaboo** — controls the whole Mac screen, not just the browser. Only useful
     later if we want to verify things OUTSIDE the browser (e.g. watching a finished
     video play in QuickTime, or testing the desktop app icon). Healthy project, but
     a complement, not a replacement.
  4. **Built-in "computer use"** — ruled out by Anthropic's own docs: in browsers it
     can only LOOK, not click or type. Not usable for our testing loop.
  5. **Everything else (PinchTab, browser-use, checklist "skills", etc.)** — either
     unproven small projects or checklists that never actually open the app. None
     beats what we have.

## What I recommend next
- **Add the Google Chrome DevTools tool** alongside Playwright — it's the only
  upgrade worth making. Free, no credentials, reversible. Say "add the DevTools tool"
  and I'll set it up and test it.
- Everything else: no action. Our current setup is already what the pros use.
- (Separate, still open from before: Pexels/Pixabay free keys for stock footage, and
  quality round 3 whenever you want it.)
