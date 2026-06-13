#!/bin/bash
set -euo pipefail

cp /etc/onlyoffice/documentserver/doya-local-template.json /etc/onlyoffice/documentserver/local.json
exec /app/ds/run-document-server.sh
