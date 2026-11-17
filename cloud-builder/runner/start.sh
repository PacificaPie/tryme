#!/bin/sh
set -eu
if [ -f /etc/cloudflare/certs/cloudflare-containers-ca.crt ]; then
  export NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt
fi
exec node /app/cloud-builder/runner/server.mjs
