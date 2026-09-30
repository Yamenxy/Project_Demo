#!/usr/bin/env bash
# Restore drill for the local setup (docs/restore-drill.md): dumps the development database from
# the Docker container, restores it into a scratch database, compares row counts of the tables
# that matter, reports the times, and removes the scratch database. Synthetic data only.
set -euo pipefail
# Git Bash on Windows rewrites /tmp/... arguments into Windows paths; these paths are inside the
# container, so keep them as they are.
export MSYS_NO_PATHCONV=1

CONTAINER="${CONTAINER:-lms-postgres-1}"
DB_USER="${DB_USER:-lms_admin}"
SOURCE_DB="${SOURCE_DB:-lms_dev}"
TARGET_DB="lms_restore_drill"
DUMP="/tmp/lms-restore-drill.dump"
TABLES="users memberships classes class_enrollments grade_entries grade_changes payment_entries \
exam_attempts exam_answers homework_submissions files audit_log notifications"

psql_in() { docker exec "$CONTAINER" psql -U "$DB_USER" -d "$1" -Atc "$2"; }

counts() {
  local db="$1" out=""
  for t in $TABLES; do out+="$t=$(psql_in "$db" "select count(*) from $t") "; done
  echo "$out"
}

before=$(counts "$SOURCE_DB")
start=$(date +%s)
docker exec "$CONTAINER" pg_dump -U "$DB_USER" -Fc -f "$DUMP" "$SOURCE_DB"
dumped=$(date +%s)
docker exec "$CONTAINER" dropdb -U "$DB_USER" --if-exists "$TARGET_DB"
docker exec "$CONTAINER" createdb -U "$DB_USER" "$TARGET_DB"
docker exec "$CONTAINER" pg_restore -U "$DB_USER" -d "$TARGET_DB" --exit-on-error "$DUMP"
restored=$(date +%s)
after=$(counts "$TARGET_DB")
size=$(docker exec "$CONTAINER" stat -c %s "$DUMP")
docker exec "$CONTAINER" dropdb -U "$DB_USER" "$TARGET_DB"
docker exec "$CONTAINER" rm -f "$DUMP"

echo "dump: $((dumped - start)) s, $((size / 1024)) KB; restore: $((restored - dumped)) s"
if [ "$before" != "$after" ]; then
  echo "MISMATCH"
  echo "source:   $before"
  echo "restored: $after"
  exit 1
fi
echo "row counts match: $after"
