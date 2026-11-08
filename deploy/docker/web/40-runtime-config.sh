#!/bin/sh
# Writes the shell's runtime config from environment variables at startup.
set -eu
echo "kb web starting version ${KB_VERSION:-dev}"
modules=""
if [ -n "${KB_ENABLED_MODULES:-}" ]; then
  modules=$(printf '%s' "$KB_ENABLED_MODULES" | sed 's/[^,][^,]*/"&"/g')
  modules=", \"enabledModules\": [${modules}]"
fi
printf '{ "apiBaseUrl": "%s"%s }\n' "${KB_API_BASE_URL:-http://localhost:8080}" "$modules" \
  > /usr/share/nginx/html/config.json
