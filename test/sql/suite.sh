#!/usr/bin/env bash
# Apply EVERY migration, then run every SQL assertion, against a PostgreSQL that
# somebody else provided.
#
# WHY THIS FILE EXISTS. The migration list used to live in two places: run.sh applied
# nine of them locally, and .github/workflows/ci.yml applied two. So CI never executed
# migrations 013 through 036 at all, and a migration Postgres flatly rejects reached
# the Supabase SQL editor before anyone found out. That happened: 032 shipped with an
# index on `checked_at::date`, which is STABLE rather than IMMUTABLE and is refused
# outright.
#
# Two lists that are supposed to agree will not, so there is now one, here, and both
# callers use it. run.sh boots a throwaway server and calls this; CI points it at a
# service container and calls this.
#
# APPLYING EVERY MIGRATION IS THE POINT, not just the ones an assertion touches. Most
# of them define no function worth asserting on, but all of them are DDL a server has
# to accept, and "does Postgres accept this" is the question that actually bites.
#
# Usage: PSQL="psql -h localhost -U postgres" ./test/sql/suite.sh
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
: "${PSQL:?set PSQL to a psql command, e.g. PSQL=\"psql -h localhost -U postgres\"}"

run() { $PSQL -q -v ON_ERROR_STOP=1 -f "$1"; }

# The stubs the migrations expect to already exist: Supabase's auth and storage
# schemas, and the tables schema.sql creates.
run "$HERE/harness.sql" > /dev/null

failed=0
for f in "$ROOT"/supabase/0*.sql; do
  if ! out=$(run "$f" 2>&1); then
    echo "MIGRATION FAILED: $(basename "$f")"
    echo "$out" | grep -m3 -E "ERROR|DETAIL" | sed 's/^/    /'
    failed=1
  fi
done
if [ "$failed" -ne 0 ]; then
  echo
  echo "A migration was rejected by PostgreSQL. It would be rejected by Supabase too."
  exit 1
fi
echo "all $(ls "$ROOT"/supabase/0*.sql | wc -l | tr -d ' ') migrations applied"

# The assertions. Every .test.sql in this directory, so adding one needs no edit here
# and cannot be forgotten.
if out=$( for t in "$HERE"/*.test.sql; do run "$t"; done 2>&1 ); then
  echo "$out" | grep -E 'PASS' | sed 's/^.*NOTICE:  //'
  echo
  echo "$(echo "$out" | grep -c PASS) assertions passed"
  # A run where every assertion silently vanished is a broken harness, not a pass.
  if [ "$(echo "$out" | grep -c PASS)" -lt 40 ]; then
    echo "Far fewer assertions than expected. Treating this as a failure."
    exit 1
  fi
else
  echo "$out" | grep -E 'PASS|FAIL|ERROR' | sed 's/^.*NOTICE:  //'
  exit 1
fi
