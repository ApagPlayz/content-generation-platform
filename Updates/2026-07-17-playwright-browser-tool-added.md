# Gave the loop a real web browser (Playwright)

_2026-07-17_

## What I did
- Added the **Playwright browser tool** (Microsoft's official "MCP" browser server) to your
  autonomous loop, so your agents can open a real Chrome, click around a page, fill forms,
  and take screenshots — instead of only reading a page's raw text.
- Wired it in the tidy way: registered the tool once (`.mcp.json`) and switched it **on for
  every agent** through one shared settings file (`.claude/settings.json`). I also wrote clear
  guidance into your project guide (`CLAUDE.md`) telling each agent when to use it:
  - **Demo** — drive the app to capture proof a feature works.
  - **Builder** — eyeball a screen it just changed before sending you the PR.
  - **Auditor** — double-check a PR's "it looks like X" claim by actually opening the page.
  - **Scout** — look at competitor sites that don't show their content as plain text.
  - **@mention** — if you ask "does this page look right?", it can go check.
- **No signup, no password, no API key** — the tool is free and runs itself.
- I tested the tool in the cloud: it starts up correctly and lists all 24 of its browser
  actions. (Opening a real page needs a one-time browser download, which the Demo agent
  already installs; the other agents install it on the fly only if they choose to use it.)

## One thing I could not fully test (please read)
- Your loop's agents live in files GitHub calls "workflows". For safety, GitHub **blocks the
  loop's own login from editing those workflow files** unless you flip one permission on. So I
  turned the browser tool on through the shared settings file instead, which should work
  everywhere without touching the protected files.
- I could not *prove* that from inside the cloud run, so I opened a short **"🔑 Action needed"**
  issue with the single, one-time click-path to flip that permission on — as a guaranteed
  backup if the browser tool doesn't show up on its own. Flipping it also fixes a separate
  problem: your weekly **Retro** agent currently can't edit those workflow files either.

## What I recommend next
- **Merge the PR** when you're ready — it only touches settings and docs, not the app itself,
  so there's very little that can go wrong.
- Open the **"🔑 Action needed"** issue and do the one step if you want the guaranteed path
  (it takes ~1 minute and also unblocks the Retro agent).
- If you'd ever like page-speed or accessibility scoring too, say the word — that's a
  different add-on I can wire in the same way.
