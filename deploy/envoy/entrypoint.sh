#!/bin/sh
# Fills the ${KNOWCEL_OIDC_*} placeholders of the generated envoy.yaml from the
# environment and starts Envoy with the result. The defaults match the dev
# Dex in deploy/infra.compose.yaml.
set -eu
issuer=${KNOWCEL_OIDC_ISSUER:-http://localhost:5556/dex}
jwks=${KNOWCEL_OIDC_JWKS_URL:-http://dex:5556/dex/keys}
audiences=${KNOWCEL_OIDC_AUDIENCES:-kb-web,kb-cli}

scheme=${jwks%%://*}
hostport=${jwks#*://}
hostport=${hostport%%/*}
host=${hostport%:*}
port=${hostport##*:}
# Every problem is reported before Envoy exits.
problems=""
problem() { problems="${problems}
  $1"; }
case "$scheme" in
  http) [ "$host" != "$hostport" ] || port=80 ;;
  https) [ "$host" != "$hostport" ] || port=443 ;;
  *) problem "KNOWCEL_OIDC_JWKS_URL: must be an http(s) URL, got \"$jwks\"" ;;
esac
case "$issuer" in
  http://?*|https://?*) ;;
  *) problem "KNOWCEL_OIDC_ISSUER: must be an http(s) URL, got \"$issuer\"" ;;
esac
case "$audiences" in
  ""|,*|*,|*,,*) problem "KNOWCEL_OIDC_AUDIENCES: must list client ids separated by commas, got \"$audiences\"" ;;
esac
if [ -n "$problems" ]; then
  echo "envoy: invalid configuration:$problems" >&2
  exit 1
fi

sed \
  -e "s|\${KNOWCEL_OIDC_ISSUER}|$issuer|g" \
  -e "s|\${KNOWCEL_OIDC_AUDIENCES}|$audiences|g" \
  -e "s|\${KNOWCEL_OIDC_JWKS_URL}|$jwks|g" \
  -e "s|\${KNOWCEL_OIDC_JWKS_CLUSTER}|oidc_$scheme|g" \
  -e "s|\${KNOWCEL_OIDC_JWKS_HOST}|$host|g" \
  -e "s|\${KNOWCEL_OIDC_JWKS_PORT}|$port|g" \
  /etc/envoy/envoy.yaml > /tmp/envoy.yaml
exec envoy -c /tmp/envoy.yaml "$@"
