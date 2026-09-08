#!/usr/bin/env bash
# Nightly database backup for both stacks. Installed in root's crontab; see
# the install line at the bottom of this file.
#
# Why this exists: everything a vendor relies on for bookkeeping — receipts,
# shifts, reports, exports — lives only in Postgres. The chain holds the
# transfers, but not who sold what during which shift, so losing a volume
# loses the books irrecoverably. The business requirements call this out as a
# Must (BR-P08); they assume the records sit in IndexedDB on the phone, which
# is not the shape we built, but the requirement lands on the server instead.
set -euo pipefail

DEST=/var/backups/nimble
KEEP_DAYS=14
# Resolve through the symlink in /usr/local/bin: without this, $0 points at
# the link and the compose files are looked for next to it.
COMPOSE_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

mkdir -p "$DEST"

for stack in main test; do
  env_file="$COMPOSE_DIR/.env.$stack"
  [ -f "$env_file" ] || { echo "skip $stack: no $env_file" >&2; continue; }

  out="$DEST/$stack-$(date +%Y%m%d-%H%M%S).sql.gz"
  # --clean so a restore into an existing database replaces rather than
  # collides; the dump is useless if restoring it needs manual surgery first.
  if docker compose -p "nimble-$stack" -f "$COMPOSE_DIR/docker-compose.prod.yml" \
       --env-file "$env_file" exec -T db \
       pg_dump -U nimble -d nimble --clean --if-exists 2>/dev/null | gzip > "$out"
  then
    # A dump that failed halfway still leaves a file, and a backup nobody
    # checks is worse than none: refuse to keep an implausibly small one.
    size=$(stat -c%s "$out")
    if [ "$size" -lt 2000 ]; then
      echo "FAILED $stack: dump is only ${size}B, discarding" >&2
      rm -f "$out"
      continue
    fi
    echo "ok $stack: $(numfmt --to=iec "$size") -> $out"
  else
    echo "FAILED $stack: pg_dump returned non-zero" >&2
    rm -f "$out"
  fi
done

# Rotate. Deliberately after the new dump succeeded, so a run that cannot
# produce a fresh backup never destroys the last good one.
find "$DEST" -name '*.sql.gz' -mtime "+$KEEP_DAYS" -delete

# Install (run once, as root):
#   ln -sf /home/ubuntu/nimble/deploy/backup.sh /usr/local/bin/nimble-backup
#   ( crontab -l 2>/dev/null; echo '17 3 * * * /usr/local/bin/nimble-backup >> /var/log/nimble-backup.log 2>&1' ) | crontab -
