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

python3 - <<'PY'
import gzip
from pathlib import Path

css_patch = """

/* Doya local preview: keep ONLYOFFICE chrome quiet inside the embedded viewer. */
section.logo,
#header-logo,
.brand-logo {
  display: none !important;
}

""".lstrip()

for path in [
    Path("/var/www/onlyoffice/documentserver/web-apps/apps/spreadsheeteditor/main/resources/css/app.css"),
    Path("/var/www/onlyoffice/documentserver/web-apps/apps/spreadsheeteditor/embed/resources/css/app-all.css"),
    Path("/var/www/onlyoffice/documentserver/sdkjs/cell/css/main.css"),
]:
    if not path.exists():
        continue
    content = path.read_text(errors="ignore")
    if "Doya local preview" not in content:
        path.write_text(content.rstrip() + "\n" + css_patch)
    gzip_path = path.with_suffix(path.suffix + ".gz")
    if gzip_path.exists():
        with gzip.open(gzip_path, "wb") as output:
            output.write(path.read_bytes())
PY

exec /app/ds/run-document-server.sh
