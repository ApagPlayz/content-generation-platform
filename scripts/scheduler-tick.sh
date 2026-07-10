#!/usr/bin/env bash
#
# Manual helper to fire the Content Engine scheduler tick from a Terminal.
# (The automated 60s trigger is the launchd job at
#  ~/Library/LaunchAgents/com.contentengine.scheduler.plist, which inlines the
#  curl + secret directly — launchd cannot exec scripts under ~/Documents due to
#  macOS TCC, so it does NOT call this file. Keep the secret here in sync with the
#  one in that plist if you rotate it.)
#
# Reads SCHEDULER_SECRET from .env.local. Run from Terminal, which has filesystem
# access. Harmlessly no-ops (logs a connection failure) when the dev server is down.
set -uo pipefail

ROOT="/Users/alessiopagliarulo/Documents/Claude Projects/Content Generation Platform"
SECRET="$(grep -E '^SCHEDULER_SECRET=' "$ROOT/.env.local" | head -1 | cut -d= -f2- | tr -d '"')"

curl -s -m 30 -X POST http://localhost:3000/api/scheduler/tick \
  -H "Authorization: Bearer ${SECRET}" \
  -w 'tick %{http_code}\n' \
  || echo "tick: server unreachable"
