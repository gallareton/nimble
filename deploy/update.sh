#!/usr/bin/env bash
# Update production from git: pull main, rebuild, restart. Run on the VPS.
#   ./update.sh          — legacy single stack (deploy/.env, port 3001)
#   ./update.sh main     — mainnet stack (.env.main, project nimble-main)
#   ./update.sh test     — testnet stack (.env.test, project nimble-test)
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
cd deploy
STACK="${1:-}"
if [ -z "$STACK" ]; then
  sudo docker compose -f docker-compose.prod.yml --env-file .env up -d --build
  PORT=3001
else
  sudo docker compose -p "nimble-$STACK" -f docker-compose.prod.yml --env-file ".env.$STACK" up -d --build
  PORT=$(grep '^APP_PORT=' ".env.$STACK" | cut -d= -f2)
fi
sudo docker image prune -f > /dev/null
curl -sf "http://127.0.0.1:${PORT}/healthz" && echo " deploy OK"
