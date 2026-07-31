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

wait_healthy() { # $1=port $2=label — app boot takes up to ~90s (cold imports)
  for _ in $(seq 1 45); do
    if curl -sf "http://127.0.0.1:$1/healthz" > /dev/null; then echo "[$2] healthy on :$1"; return 0; fi
    sleep 2
  done
  echo "[$2] FAILED health check on :$1" >&2; return 1
}

one() {
  local stack="$1"
  sudo docker compose -p "nimble-$stack" -f docker-compose.prod.yml --env-file ".env.$stack" up -d --build
  local port
  port=$(grep '^APP_PORT=' ".env.$stack" | cut -d= -f2)
  wait_healthy "$port" "$stack"
}

case "${1:-both}" in
  both) one main; one test ;;
  legacy) sudo docker compose -f docker-compose.prod.yml --env-file .env up -d --build
          wait_healthy 3001 legacy ;;
  *) one "$1" ;;
esac
sudo docker image prune -f > /dev/null
echo "deploy OK"
