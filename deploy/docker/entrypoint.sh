#!/bin/sh
# Fix volume ownership then drop to appuser (uid 10001).
set -e
mkdir -p /app/data /app/src/monitoring/logs 2>/dev/null || true
if [ "$(id -u)" = "0" ]; then
  chown -R appuser:appuser /app/data /app/src/monitoring/logs 2>/dev/null || true
  if command -v runuser >/dev/null 2>&1; then
    exec runuser -u appuser -- "$@"
  fi
  exec su -s /bin/sh appuser -c 'exec "$0" "$@"' -- "$@"
fi
exec "$@"
