#!/usr/bin/env bash
# Update production from git: pull main, rebuild, restart. Run on the VPS.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
cd deploy
sudo docker compose -f docker-compose.prod.yml --env-file .env up -d --build
sudo docker image prune -f > /dev/null
curl -sf http://127.0.0.1:3001/healthz && echo " deploy OK"
