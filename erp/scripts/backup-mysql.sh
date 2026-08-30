#!/bin/sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
MYSQL_HOST="${MYSQL_HOST:-mysql}"
MYSQL_DATABASE="${MYSQL_DATABASE:-takealot_erp}"

if [ -z "${MYSQL_PWD:-}" ] && [ -n "${MYSQL_ROOT_PASSWORD:-}" ]; then
  MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
  export MYSQL_PWD
fi

if [ -z "${MYSQL_PWD:-}" ]; then
  echo "MYSQL_ROOT_PASSWORD is required" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

dump_once() {
  ts="$(date +%Y%m%d-%H%M%S)"
  dest="$BACKUP_DIR/takealot_erp-${ts}.sql.gz"
  tmp="$dest.tmp"

  i=0
  while [ "$i" -lt 30 ]; do
    if mysqladmin ping -h "$MYSQL_HOST" -uroot --silent >/dev/null 2>&1; then
      break
    fi
    i=$((i + 1))
    sleep 2
  done

  mysqldump \
    -h "$MYSQL_HOST" \
    -uroot \
    --single-transaction \
    --routines \
    --triggers \
    --set-gtid-purged=OFF \
    "$MYSQL_DATABASE" | gzip > "$tmp"

  mv "$tmp" "$dest"
  echo "$dest" > "$BACKUP_DIR/.last-ok"
  echo "backup ok: $dest ($(wc -c < "$dest") bytes)"

  find "$BACKUP_DIR" -type f -name 'takealot_erp-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
}

dump_once

while :; do
  sleep 86400
  dump_once
done
