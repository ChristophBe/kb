#!/bin/sh
# Writes the shell's runtime config from environment variables at startup.
set -eu
echo "kb web starting version ${KB_VERSION:-dev}"
modules=""
if [ -n "${KB_ENABLED_MODULES:-}" ]; then
  modules=$(printf '%s' "$KB_ENABLED_MODULES" | sed 's/[^,][^,]*/"&"/g')
  modules=", \"enabledModules\": [${modules}]"
fi
auth=$(printf '"auth": { "issuer": "%s", "clientId": "%s" }' \
  "${KB_OIDC_ISSUER:-http://localhost:5556/dex}" "${KB_OIDC_CLIENT_ID:-kb-web}")
printf '{ "apiBaseUrl": "%s", %s%s }\n' "${KB_API_BASE_URL:-http://localhost:8080}" "$auth" "$modules" \
  > /usr/share/nginx/html/config.json
