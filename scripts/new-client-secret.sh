#!/usr/bin/env bash
# Generates an OIDC client secret. Prints two lines:
#   1. the plain secret, for the application (never commit it),
#   2. its PBKDF2 digest in Base64, for Authelia (an OIDC_*_SECRET_DIGEST_B64 variable).
set -euo pipefail
image=authelia/authelia:4.39.28
out=$(docker run --rm "$image" authelia crypto hash generate pbkdf2 --variant sha512 \
  --random --random.length 72 --random.charset rfc3986)
echo "$out" | sed -n 's/^Random Password: //p'
echo "$out" | sed -n 's/^Digest: //p' | tr -d '\n' | base64 -w0
echo
