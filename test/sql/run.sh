#!/usr/bin/env bash
# Throwaway PostgreSQL, apply migration 006, run the credit tests, tear down.
set -euo pipefail

command -v initdb >/dev/null || { echo "initdb not found (brew install postgresql@16)"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DIR="$(mktemp -d)"
PORT=54999
cleanup() { pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

initdb -D "$DIR/data" -U postgres --auth=trust -E UTF8 >"$DIR/initdb.log" 2>&1
pg_ctl -D "$DIR/data" -o "-p $PORT -k /tmp -c listen_addresses=''" -l "$DIR/pg.log" start >/dev/null
sleep 2

run() { psql -h /tmp -p $PORT -U postgres -q -v ON_ERROR_STOP=1 -f "$1"; }
run "$HERE/harness.sql" >/dev/null
run "$ROOT/supabase/006_credits_and_subscription.sql" >/dev/null
run "$ROOT/supabase/010_owner_unlocks.sql" >/dev/null
run "$ROOT/supabase/012_spend_credits.sql" >/dev/null
run "$ROOT/supabase/031_lead_reports.sql" >/dev/null
# APPLIED, not just tested. 032 and 033 contain no functions worth asserting on, but
# they are DDL that Postgres has to accept, and a migration nobody ever ran against a
# real server is a migration that fails in the SQL editor instead. 032 shipped with an
# index on `checked_at::date`, which is STABLE rather than IMMUTABLE and is rejected
# outright; nothing here would have noticed, because nothing here applied the file.
run "$ROOT/supabase/032_quality_samples.sql" >/dev/null
run "$ROOT/supabase/033_search_metrics.sql" >/dev/null
run "$ROOT/supabase/034_icp_criteria.sql" >/dev/null
run "$ROOT/supabase/036_business_index.sql" >/dev/null

if out=$( { run "$HERE/credits.test.sql"; run "$HERE/spend.test.sql"; run "$HERE/report.test.sql"; run "$HERE/quality.test.sql"; run "$HERE/index.test.sql"; } 2>&1 ); then
  echo "$out" | grep -E 'PASS' | sed 's/^.*NOTICE:  //'
  echo
  echo "$(echo "$out" | grep -c PASS) assertions passed"
else
  echo "$out" | grep -E 'PASS|FAIL|ERROR' | sed 's/^.*NOTICE:  //'
  exit 1
fi
