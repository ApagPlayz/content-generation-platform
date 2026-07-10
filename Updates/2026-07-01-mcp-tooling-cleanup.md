# MCP tooling cleanup

_2026-07-01_

## What I did
- Reviewed all the external "tool add-ons" (MCP servers) connected to Claude and found several doing the same job.
- **Removed a duplicate Playwright** — the browser-testing tool was loaded twice. Kept one copy, dropped the extra.
- **Removed "fetcher"** — a basic web-fetching tool that Firecrawl already does better.
- **Removed "chrome-devtools-mcp"** — overlapped with Playwright for browser testing; its extra powers (page-speed and accessibility audits) aren't used by this platform.
- Left the disabled GitHub connector as-is — it was already off, and the setup uses the `gh` command instead.
- Backed up the config before changing anything, so nothing is lost.
- **Result:** ~50+ redundant tools trimmed, with no loss of anything the platform actually uses. Kept: Playwright (browser testing), Firecrawl (web search + scraping), Context7 (library docs).

## What I recommend next
- **Restart Claude Code** so the changes fully take effect (the removed tools linger until then).
- After restarting, run `/verify` or `npm run go` once to confirm browser testing still works — I expect it to.
- If you ever want page-speed or accessibility audits, tell me and I'll re-add the Chrome DevTools tool — it's the right tool for that specific job.
- Note: these changes apply across **all** your projects (the tools were set up globally), which is intended since the duplication existed everywhere.
