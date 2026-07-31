#!/usr/bin/env bash
# Update production from git. Run on the VPS.
#   ./update.sh          — deploy BOTH stacks (main + test)
#   ./update.sh main     — mainnet stack only (.env.main, project nimble-main)
#   ./update.sh test     — testnet stack only (.env.test, project nimble-test)
#   ./update.sh legacy   — the pre-unified single stack (deploy/.env, port 3001)
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
cd deploy

one() {
  local stack="$1"
  sudo docker compose -p "nimble-$stack" -f docker-compose.prod.yml --env-file ".env.$stack" up -d --build
  local port
  port=$(grep '^APP_PORT=' ".env.$stack" | cut -d= -f2)
  curl -sf "http://127.0.0.1:${port}/healthz" > /dev/null && echo "[$stack] healthy on :$port"
}

case "${1:-both}" in
  both) one main; one test ;;
  legacy) sudo docker compose -f docker-compose.prod.yml --env-file .env up -d --build
          curl -sf http://127.0.0.1:3001/healthz > /dev/null && echo "[legacy] healthy on :3001" ;;
  *) one "$1" ;;
esac
sudo docker image prune -f > /dev/null
echo "deploy OK"
