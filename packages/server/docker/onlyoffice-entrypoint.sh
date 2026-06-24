#!/bin/bash
set -euo pipefail

python3 - <<'PY'
import json
from pathlib import Path

target_path = Path("/etc/onlyoffice/documentserver/local.json")
overlay_path = Path("/tmp/doya-onlyoffice-local.json")

target = json.loads(target_path.read_text()) if target_path.exists() else {}
overlay = json.loads(overlay_path.read_text())


def merge(base, update):
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge(base[key], value)
        else:
            base[key] = value


merge(target, overlay)
target_path.write_text(json.dumps(target, indent=2) + "\n")
PY

exec /app/ds/run-document-server.sh
