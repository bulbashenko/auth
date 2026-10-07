#!/usr/bin/env bash
# Prints a new RSA private key for signing OIDC tokens, Base64-encoded on one line,
# ready for the OIDC_JWK_RS256_B64 variable. Rotating it invalidates every issued token.
set -euo pipefail
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 2>/dev/null | base64 -w0
echo
