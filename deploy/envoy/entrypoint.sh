#!/bin/sh
# Fills the ${KB_OIDC_*} placeholders of the generated envoy.yaml from the
# environment and starts Envoy with the result. The defaults match the dev
# Dex in deploy/infra.compose.yaml.
set -eu
issuer=${KB_OIDC_ISSUER:-http://localhost:5556/dex}
jwks=${KB_OIDC_JWKS_URL:-http://dex:5556/dex/keys}
audiences=${KB_OIDC_AUDIENCES:-kb-web,kb-cli}

scheme=${jwks%%://*}
hostport=${jwks#*://}
hostport=${hostport%%/*}
host=${hostport%:*}
port=${hostport##*:}
case "$scheme" in
  http) [ "$host" != "$hostport" ] || port=80 ;;
  https) [ "$host" != "$hostport" ] || port=443 ;;
  *) echo "KB_OIDC_JWKS_URL must be an http(s) URL: $jwks" >&2; exit 1 ;;
esac

sed \
  -e "s|\${KB_OIDC_ISSUER}|$issuer|g" \
  -e "s|\${KB_OIDC_AUDIENCES}|$audiences|g" \
  -e "s|\${KB_OIDC_JWKS_URL}|$jwks|g" \
  -e "s|\${KB_OIDC_JWKS_CLUSTER}|oidc_$scheme|g" \
  -e "s|\${KB_OIDC_JWKS_HOST}|$host|g" \
  -e "s|\${KB_OIDC_JWKS_PORT}|$port|g" \
  /etc/envoy/envoy.yaml > /tmp/envoy.yaml
exec envoy -c /tmp/envoy.yaml "$@"
