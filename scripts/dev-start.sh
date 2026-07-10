#!/usr/bin/env bash
# Start the Content Engine platform for local testing.
# Usage:  bash scripts/dev-start.sh   (or: npm run go)
# Idempotent: safe to run repeatedly. Brings up everything needed and opens the app.
set -euo pipefail

cd "$(dirname "$0")/.."
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"
KOKORO_HEALTH="http://localhost:8880/health"

echo "▶ Content Engine — starting on ${URL}"

# --- Free voice engine (Kokoro, runs in Docker) ----------------------------
# The narration voice runs as a Docker container (kokoro-fastapi on :8880). We
# make sure Docker Desktop + that container are up so the launcher brings up
# *everything* needed. All steps are best-effort: if Docker is missing or slow,
# the app still launches and simply uses a fallback voice until Kokoro is ready.

kokoro_up() { curl -fsS -m 2 "${KOKORO_HEALTH}" >/dev/null 2>&1; }

# Kick Docker Desktop off early (non-blocking) so it boots while we prep the DB.
kick_docker() {
  command -v docker >/dev/null 2>&1 || return 0
  docker info >/dev/null 2>&1 && return 0   # daemon already up
  echo "▶ Launching Docker Desktop in the background (needed for the free voice)…"
  open -a Docker 2>/dev/null || open -a "Docker Desktop" 2>/dev/null || true
}

# Start the Kokoro container (auto-discovered by name or image) if it isn't up.
start_kokoro_container() {
  local ids
  ids="$(docker ps -aq --filter 'name=kokoro' 2>/dev/null || true)"
  if [ -z "${ids}" ]; then
    ids="$(docker ps -a --format '{{.ID}} {{.Image}}' 2>/dev/null | grep -i kokoro | awk '{print $1}' || true)"
  fi
  if [ -n "${ids}" ]; then
    echo "▶ Starting the Kokoro voice container…"
    echo "${ids}" | xargs docker start >/dev/null 2>&1 || true
  fi
}

# Ensure the voice engine is reachable. Best-effort; never aborts the launch.
ensure_kokoro() {
  if kokoro_up; then echo "✓ Kokoro voice engine already running."; return 0; fi
  command -v docker >/dev/null 2>&1 || {
    echo "  ⚠ Docker not installed — using the fallback voice."; return 0; }

  # Wait for the Docker daemon (Desktop can take ~30–60s to boot after launch).
  if ! docker info >/dev/null 2>&1; then
    printf "▶ Waiting for Docker to start"
    for _ in $(seq 1 45); do
      docker info >/dev/null 2>&1 && break
      printf "."; sleep 2
    done
    echo
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "  ⚠ Docker didn't come up — the app will use the fallback voice."; return 0
  fi

  kokoro_up && { echo "✓ Kokoro voice engine running."; return 0; }
  start_kokoro_container

  printf "▶ Waiting for the Kokoro voice engine to be ready"
  for _ in $(seq 1 30); do
    if kokoro_up; then echo " — ✓ ready."; return 0; fi
    printf "."; sleep 2
  done
  echo
  echo "  ⚠ Kokoro isn't responding yet — the app will start and use the fallback"
  echo "    voice until it comes up (check Docker Desktop for the Kokoro container)."
}

kick_docker

# 1. Already running? Make sure the voice engine is up, then just open it.
if lsof -ti:"${PORT}" >/dev/null 2>&1; then
  ensure_kokoro || true
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

# 5. Make sure the free voice engine is up (Docker has been booting since step 0).
ensure_kokoro || true

# 6. Launch dev server and open the browser.
echo "▶ Launching Next.js dev server. Ctrl+C to stop."
( sleep 3; open "${URL}" 2>/dev/null || true ) &
exec npm run dev
