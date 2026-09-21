#!/usr/bin/env bash
set -euo pipefail

STATE_DIR="${NODEPROX_MAINTENANCE_STATE_DIR:-/run/nodeprox-maintenance}"

if [[ -f "$STATE_DIR/enabled" ]]; then
  echo "Maintenance mode: ON"
else
  echo "Maintenance mode: OFF"
fi
