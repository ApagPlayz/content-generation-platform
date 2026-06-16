# Content Engine — Project Guide

Local AI short-form video platform (Next.js 15 + Prisma/SQLite). This file loads into
Claude's context every session — it's the canonical "how to run & test" reference.

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
