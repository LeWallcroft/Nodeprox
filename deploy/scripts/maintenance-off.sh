#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
STATE_DIR="${NODEPROX_MAINTENANCE_STATE_DIR:-/run/nodeprox-maintenance}"

compose() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

compose exec -T reverse-proxy caddy validate \
  --config /etc/caddy/Caddyfile \
  --adapter caddyfile

rm -f "$STATE_DIR/enabled"

if ! compose exec -T reverse-proxy caddy reload \
  --config /etc/caddy/Caddyfile \
  --adapter caddyfile; then
  mkdir -p "$STATE_DIR"
  touch "$STATE_DIR/enabled"
  exit 1
fi

echo "Maintenance mode: OFF"
