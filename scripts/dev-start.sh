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

# --- Staleness guard --------------------------------------------------------
# A dev server left running from before a merge/branch switch serves old code.
# We stamp the code version at launch; on re-run, a mismatched (or missing)
# stamp means the running server is stale → kill it and do a full fresh start.
STATE_FILE=".dev-server.state"

code_stamp() {
  {
    git rev-parse HEAD 2>/dev/null || echo "no-git"
    git status --porcelain 2>/dev/null || true
    shasum prisma/schema.prisma package-lock.json 2>/dev/null || true
  } | shasum | awk '{print $1}'
}

# State file format: "<mode> <stamp>" (e.g. "prod ab12…"). The stamp part tells
# us whether the code changed; the mode tells us what kind of server/build it was.
state_stamp() { awk '{print $NF}' "${STATE_FILE}" 2>/dev/null || true; }
state_mode()  { awk '{print $1}'  "${STATE_FILE}" 2>/dev/null || true; }

# The mode we want this launch: prod (default) or dev (DEV=1 npm run go).
WANT_MODE="prod"; [ "${DEV:-0}" = "1" ] && WANT_MODE="dev"

# 1. Already running? Reuse it only if it's serving the current code in the right mode.
if lsof -ti:"${PORT}" >/dev/null 2>&1; then
  if [ -f "${STATE_FILE}" ] && [ "$(state_stamp)" = "$(code_stamp)" ] && [ "$(state_mode)" = "${WANT_MODE}" ]; then
    ensure_kokoro || true
    echo "✓ Content Engine already running on port ${PORT} with current code. Opening it."
    open "${URL}" 2>/dev/null || true
    exit 0
  fi
  echo "▶ A server is running but the code (or mode) has changed since it started."
  echo "  Restarting it so you never see a stale version…"
  pm2 delete content-engine >/dev/null 2>&1 || true
  lsof -ti:"${PORT}" | xargs kill 2>/dev/null || true
  for _ in $(seq 1 15); do
    lsof -ti:"${PORT}" >/dev/null 2>&1 || break
    sleep 1
  done
  if lsof -ti:"${PORT}" >/dev/null 2>&1; then
    lsof -ti:"${PORT}" | xargs kill -9 2>/dev/null || true
    sleep 2
  fi
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

# 6. Launch the app.
#    Default: PRODUCTION mode — pre-built, fast, no blank compile pauses, no
#    hot-reload breakage. Rebuilds only when the code fingerprint changed.
#    Escape hatch for development work:  DEV=1 npm run go  (live-reloading dev server).
if [ "${DEV:-0}" = "1" ]; then
  echo "dev $(code_stamp)" > "${STATE_FILE}"
  echo "▶ Launching Next.js DEV server (live reload). Ctrl+C to stop."
  ( sleep 3; open "${URL}" 2>/dev/null || true ) &
  exec npm run dev
fi

# A real production build leaves .next/BUILD_ID behind; dev mode does not.
if [ ! -f .next/BUILD_ID ] || [ "$(state_mode)" != "prod" ] || [ "$(state_stamp)" != "$(code_stamp)" ]; then
  echo "▶ Building the app (code changed since last build — takes a minute)…"
  if npm run build; then
    echo "prod $(code_stamp)" > "${STATE_FILE}"
  else
    echo "  ⚠ Build failed — starting in dev mode instead so you're not stuck."
    echo "    (The next launch will retry the build.)"
    rm -f "${STATE_FILE}"
    ( sleep 3; open "${URL}" 2>/dev/null || true ) &
    exec npm run dev
  fi
else
  echo "✓ App already built for this code version — skipping build."
fi

# Production server is managed by PM2 when available: it stays up in the
# background, survives crashes, and (via the login LaunchAgent) starts at login.
if command -v pm2 >/dev/null 2>&1; then
  echo "▶ Launching Content Engine (production mode, kept alive by PM2)…"
  pm2 delete content-engine >/dev/null 2>&1 || true
  pm2 start npm --name content-engine -- start >/dev/null
  pm2 save >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do
    curl -fsS -m 2 "${URL}" >/dev/null 2>&1 && break
    sleep 1
  done
  open "${URL}" 2>/dev/null || true
  echo "✓ Content Engine is up and will stay running in the background."
  echo "  (Logs: pm2 logs content-engine · Stop: pm2 stop content-engine)"
  exit 0
fi

echo "▶ Launching Content Engine (production mode). Ctrl+C to stop."
( sleep 2; open "${URL}" 2>/dev/null || true ) &
exec npm run start
