#!/bin/bash
# Declarative LLDAP bootstrap: groups from group-configs/, plus the service user Authelia binds as.
# Real people are managed in the LLDAP UI, not here, so nothing is cleaned up.
set -euo pipefail

work=$(mktemp -d)
mkdir -p "$work/users"

jq -n --arg email "$LDAP_BIND_EMAIL" --arg password "$LDAP_BIND_PASSWORD" '{
  id: "authelia",
  email: $email,
  password: $password,
  displayName: "Authelia (service)",
  groups: ["lldap_password_manager"]
}' > "$work/users/authelia.json"

export USER_CONFIGS_DIR="$work/users"
export GROUP_CONFIGS_DIR=/bootstrap/group-configs
export USER_SCHEMAS_DIR="$work/none"
export GROUP_SCHEMAS_DIR="$work/none"
export DO_CLEANUP=false

exec /bin/bash /bootstrap/bootstrap.sh
