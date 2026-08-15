#!/bin/sh
set -e
if [ "${AUTO_SCHEMA_SYNC:-false}" = "true" ]; then
  npx prisma db push --skip-generate
fi
exec "$@"
