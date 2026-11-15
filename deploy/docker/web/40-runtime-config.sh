#!/bin/sh
# Writes the shell's runtime config from environment variables at startup.
set -eu
echo "kb web starting version ${KNOWCEL_VERSION:-dev}"
modules=""
if [ -n "${KNOWCEL_ENABLED_MODULES:-}" ]; then
  modules=$(printf '%s' "$KNOWCEL_ENABLED_MODULES" | sed 's/[^,][^,]*/"&"/g')
  modules=", \"enabledModules\": [${modules}]"
fi
auth=$(printf '"auth": { "issuer": "%s", "clientId": "%s" }' \
  "${KNOWCEL_OIDC_ISSUER:-http://localhost:5556/dex}" "${KNOWCEL_OIDC_CLIENT_ID:-kb-web}")
printf '{ "apiBaseUrl": "%s", %s%s }\n' "${KNOWCEL_API_BASE_URL:-http://localhost:8080}" "$auth" "$modules" \
  > /usr/share/nginx/html/config.json
