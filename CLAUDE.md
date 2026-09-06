# Content Engine — Project Guide

Local AI short-form video platform (Next.js 15 + Prisma/SQLite). This file loads into
Claude's context every session — it's the canonical "how to run & test" reference.

## 💎 MEMBERSHIP & TOKEN BUDGET (read this first — applies to EVERY session)

The owner is on the **Claude Max 20× plan** (the highest membership tier). Token usage is
**not a constraint** — do not hold back on thoroughness, multi-agent workflows, deep
research, or large parallel passes to save tokens. When a more exhaustive or higher-quality
approach exists, **suggest it and lean toward it**, even if it's token-heavy. Default to the
most complete, correct answer rather than the cheapest one.

**Tracking remaining usage:** the owner wants to keep an eye on how much of the limit is
left in the rolling **5-hour session window** and the **weekly window**. The built-in way to
check this is the **`/usage`** command (aliases `/cost`, `/stats`) — it shows both windows
together along with current session cost. There is no live status-line counter for this;
when the owner asks "how much do I have left?", point them to `/usage`.

## ⭐ HOW TO REPORT TO THE OWNER (read this first — applies to EVERY session)

The owner is non-technical and wants plain, skimmable summaries — not code, not jargon.
After finishing any meaningful piece of work:

1. **In chat:** reply in simple bullet points. Skip the technical detail unless asked.
   Two short sections only:
   - **What I did** — plain language, what changed for the owner.
   - **What I recommend next** — clear next steps / options.
2. **Also write a file** to the `Updates/` folder in this project (create it if missing):
   - Filename: `Updates/YYYY-MM-DD-short-title.md` (use the date from session context).
   - Same two sections, same plain bullets. No code blocks unless essential.
   - This folder is for the owner's running record — **summaries only, never source code.**

Keep it short. If something is complicated, say the takeaway, not the mechanics.
Template lives in `Updates/README.md`.

## ▶ How to run the app (do this when asked to "run", "open", "test", or "start" it)

**One command — always start here:**

```bash
npm run go
```

This runs `scripts/dev-start.sh`, which is idempotent and handles everything:
1. If the server is already up on port 3000, it just opens the browser and exits.
2. Installs deps if `node_modules` is missing.
3. Generates the Prisma client and pushes the schema (creates the SQLite DB if absent).
4. Seeds demo data (sports + true crime) — skipped/ignored if already seeded.
5. Starts `next dev` and opens `http://localhost:3000`.

App URL: **http://localhost:3000**

### Restart cleanly (after code/schema changes, or if it's misbehaving)
```bash
lsof -ti:3000 | xargs kill 2>/dev/null; npm run go
```

### Running it yourself in the session
If you (the user) want the output in this chat, type: `! npm run go`

## Key facts / gotchas
- **Node:** v26 installed. **Package manager:** npm.
- **Database:** SQLite. `DATABASE_URL="file:./prisma/dev.db"` resolves *relative to the
  schema dir*, so the actual file lives at `prisma/prisma/dev.db` (Prisma quirk — not a bug).
- **Env files:** `.env` and `.env.local` are committed-light (DB URL + app name only).
  YouTube auto-publish (Phase 2) needs Google Cloud OAuth creds added by the operator
  before that feature works — the rest of the app runs without them.
- After editing `prisma/schema.prisma`, run `npm run prisma:push` (the start script does
  this automatically on launch).
- **Render engine:** the assemble stage defaults to ffmpeg. Set `RENDER_ENGINE=remotion`
  in `.env.local` to render via the Remotion compositions in `video/` (animated
  captions, 9:16 framing); it auto-falls back to ffmpeg on any error. The first Remotion
  render downloads a headless Chromium (one-time). Preview compositions with
  `npm run remotion:studio`. The `video/` dir is named to avoid shadowing the `remotion`
  npm package, is excluded from Next's tsconfig, and is built by Remotion's own webpack.

## Browser automation for the loop (Playwright MCP)

The autonomous-loop agents can drive a **real Chromium browser** through the Playwright
MCP server (`@playwright/mcp`, registered in `.mcp.json`; its tools are named
`mcp__playwright__browser_*` and are allowed for every agent via `.claude/settings.json`).
Use it to open a page, click, fill a form, and screenshot — i.e. to *see* the live UI,
not just read source. It is not a substitute for the build/test suite; skip it entirely
for backend-only work.

When each agent should reach for it:
- **Builder** — verify a UI change you just made actually renders before opening the PR.
- **Demo** — drive the affected pages to capture screenshot proof a feature works.
- **Auditor** — confirm a PR's visual claim yourself instead of taking its word for it.
- **Scout** — read JS-rendered competitor pages that plain WebFetch can't see.
- **@mention** — when the owner asks how a live page looks or behaves.

The browser binary is preinstalled in the **Demo** job. In the other jobs, run
`npx playwright install chromium` once (via Bash) before your first `browser_navigate`;
boot the app with `npm run dev` first if you need to drive it.

## Useful commands
| Task | Command |
|------|---------|
| Start / open app | `npm run go` |
| Dev server only | `npm run dev` |
| Build (prod check) | `npm run build` |
| Lint | `npm run lint` |
| Regenerate Prisma client | `npm run prisma:generate` |
| Push schema to DB | `npm run prisma:push` |
| Browse the DB (GUI) | `npm run prisma:studio` |
| Re-seed demo data | `node scripts/seed-sports.mjs && node scripts/seed-truecrime.mjs` |

## Verifying a change works
Use the Playwright MCP tools (plugin enabled) to drive `http://localhost:3000` and take
screenshots, or the `/verify` skill. Reference UI screenshots live in the repo root
(`dashboard-overview.png`, `landing-page.png`, etc.).

## Before you start: read LEARNINGS.md
`LEARNINGS.md` records mistakes previously made on this repo. Read it first and do not
repeat them. It is maintained by the weekly retro (see `docs/AUTONOMOUS-LOOP.md`) and only
changes through a pull request the owner merges.
