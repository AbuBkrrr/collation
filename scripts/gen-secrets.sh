#!/bin/sh
# Generate strong random secrets for a fresh deployment and print them ready to paste into .env.
# Usage:  sh scripts/gen-secrets.sh        (prints to the screen)
#         sh scripts/gen-secrets.sh >> .env && chmod 600 .env
set -e
rnd() { openssl rand -hex "${1:-32}"; }
cat <<EOF
# --- generated $(date -u +%Y-%m-%dT%H:%M:%SZ) — keep secret, never commit ---
JWT_SECRET=$(rnd 32)
DB_PASSWORD=$(rnd 24)
TURN_SECRET=$(rnd 24)
LK_KEY=API$(rnd 4 | cut -c1-8)
LK_SECRET=$(rnd 32)
EOF
echo "# Reminder: set DATABASE_URL's password to the DB_PASSWORD above, then: chmod 600 .env" 1>&2
