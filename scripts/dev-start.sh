#!/usr/bin/env bash
# Start the Content Engine platform for local testing.
# Usage:  bash scripts/dev-start.sh   (or: npm run go)
# Idempotent: safe to run repeatedly. Brings up everything needed and opens the app.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

echo "▶ Content Engine — starting on ${URL}"

# 1. Already running? Just open it.
if lsof -ti:"${PORT}" >/dev/null 2>&1; then
  echo "✓ Dev server already running on port ${PORT}. Opening browser."
  open "${URL}" 2>/dev/null || true
  echo "  (To restart cleanly:  lsof -ti:${PORT} | xargs kill  then re-run this script.)"
  exit 0
fi

# 2. Dependencies.
if [ ! -d node_modules ]; then
  echo "▶ Installing dependencies (first run)…"
  npm install
fi

# 3. Database: generate client + ensure schema is pushed. SQLite file is created if missing.
echo "▶ Syncing Prisma client + database…"
npm run prisma:generate >/dev/null
npm run prisma:push

# 4. Optional seed if the DB looks empty (factories table). Non-fatal if scripts absent.
if [ -f scripts/seed-sports.mjs ]; then
  echo "▶ Seeding demo data (sports + true crime)… (ignore if already seeded)"
  node scripts/seed-sports.mjs 2>/dev/null || true
  node scripts/seed-truecrime.mjs 2>/dev/null || true
fi

# 5. Launch dev server and open the browser.
echo "▶ Launching Next.js dev server. Ctrl+C to stop."
( sleep 3; open "${URL}" 2>/dev/null || true ) &
exec npm run dev
