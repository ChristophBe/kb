#!/bin/sh
issuer=${KNOWCEL_OIDC_ISSUER:-http://localhost:5556/dex}
sed -e "s|\${KNOWCEL_OIDC_ISSUER}|$issuer|g" -e "s|\${KNOWCEL_PLACEHOLDER}|x|g" envoy.yaml
