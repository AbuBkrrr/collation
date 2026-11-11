#!/bin/sh
# Drop from root to the unprivileged "node" user for the server process, after making sure the data
# directory it writes to is owned by that user. If anything here is unexpected, fall back to running
# the command unchanged so the app always starts (an election day is no time for a boot loop).
set -e
DIR="${DATA_DIR:-/app/data}"
mkdir -p "$DIR"
if [ "$(id -u)" = "0" ] && command -v su-exec >/dev/null 2>&1; then
  chown -R node:node "$DIR" 2>/dev/null || true
  exec su-exec node:node "$@"
fi
exec "$@"
