#!/bin/sh
issuer=${KB_OIDC_ISSUER:-http://localhost:5556/dex}
sed -e "s|\${KB_OIDC_ISSUER}|$issuer|g" -e "s|\${KB_PLACEHOLDER}|x|g" envoy.yaml
