#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/../node_modules/.bin:$PATH"

source "$SCRIPT_DIR/dev-home.sh"
configure_dev_doya_home

if [ -z "${DOYA_LOCAL_MODELS_DIR:-}" ]; then
  export DOYA_LOCAL_MODELS_DIR="$HOME/.doya/models/local-speech"
  mkdir -p "$DOYA_LOCAL_MODELS_DIR"
fi

echo "══════════════════════════════════════════════════════"
echo "  Doya Dev Daemon"
echo "══════════════════════════════════════════════════════"
echo "  Home:    ${DOYA_HOME}"
echo "  Models:  ${DOYA_LOCAL_MODELS_DIR}"
echo "══════════════════════════════════════════════════════"

export DOYA_CORS_ORIGINS="${DOYA_CORS_ORIGINS:-*}"
export DOYA_NODE_INSPECT="${DOYA_NODE_INSPECT:---inspect=0}"
export DOYA_RELAY_ENABLED="${DOYA_RELAY_ENABLED:-0}"

exec npm run dev:server
