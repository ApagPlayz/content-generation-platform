# Deep research: what's missing for the best workflow

_2026-07-10_

## What I did
- Ran a deep multi-agent research pass (104 agents, every claim fact-checked against
  live sources) on the tools and setup this project is missing — triggered by today's
  frustration: you couldn't show me your screen, and the app kept looking stale/blank.
- Also fixed the root of the blank-page problem the same day: the app now runs in fast
  "production mode" via your launcher instead of fragile developer mode.

## What the research found (the short version)

**1. You CAN let me see your screen — no third-party tools needed.**
- **Claude in Chrome (best fit, official):** an official Anthropic feature lets me drive
  your real, visible Chrome browser — open the app, click around, read errors — while you
  watch. It's made exactly for checking a local app like ours. Needs: Google Chrome plus
  Anthropic's Chrome extension, then we turn it on with one command.
- **Built-in screen control (official, newer):** Claude Code has a built-in "computer use"
  feature on Mac (your plan qualifies) where I can see and control approved apps on your
  actual screen. Needs two macOS permissions (Accessibility + Screen Recording). It's
  slower and more limited than the Chrome option — good backup.
- **Peekaboo (third-party, well-maintained):** a screenshot tool that lets me capture any
  app window. Fallback if the official options fall short.

**2. Making the app feel like a real installed app.**
- Done today: production mode (fast, no blank pages).
- Optional next: auto-start the app when you log in (PM2), and wrap it in a real Mac app
  window with its own icon (Pake) instead of a browser tab. Both are real, maintained,
  free tools — I'd set them up, you'd just approve.

**3. Video-pipeline tools worth (and not worth) adding.**
- **Worth a look:** "Kinocut" (mcp-video) — a very actively maintained video-editing
  toolkit (135 tools) that could let you ask me to trim/reframe/repurpose videos
  conversationally. Optional — our pipeline already edits video internally.
- **Not worth it (verified dead or near-dead):** the YouTube-analytics MCP (abandoned
  after one day), the Pexels stock-footage MCP (zero adoption — and our app already has
  Pexels built in, it just needs a free API key), the Kokoro voice MCP (we already run
  Kokoro better in-pipeline), and video-audio-mcp (abandoned 13+ months).

## What I recommend next
- **Say yes to "Claude in Chrome"** — the single biggest fix for the "you can't see what
  I see" problem. You install Chrome + the extension; I handle the rest.
- Optionally also enable the built-in screen control (two permission toggles in System
  Settings) as a backup.
- If you want the full installed-app feel: say the word and I'll set up auto-start + a
  real app icon (Pake + PM2).
- Skip the dead tools above; add the free Pexels key when you want real stock footage.
- Still pending: your pick for content factory #3 (recommendation: history/business
  mini-docs).
