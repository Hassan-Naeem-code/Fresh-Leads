#!/usr/bin/env bash
# Throwaway PostgreSQL, run the whole SQL suite against it, tear down.
#
# The suite itself (which migrations, which assertions) lives in suite.sh, which CI
# also runs. Keeping the list in one place is deliberate: it used to live here AND in
# .github/workflows/ci.yml, the two disagreed, and CI ended up never applying
# migrations 013 through 036.
set -euo pipefail

command -v initdb >/dev/null || { echo "initdb not found (brew install postgresql@16)"; exit 1; }

HERE="$(cd "$(dirname "$0")" && pwd)"
DIR="$(mktemp -d)"
PORT=54999
cleanup() { pg_ctl -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT

initdb -D "$DIR/data" -U postgres --auth=trust -E UTF8 >"$DIR/initdb.log" 2>&1
pg_ctl -D "$DIR/data" -o "-p $PORT -k /tmp -c listen_addresses=''" -l "$DIR/pg.log" start >/dev/null
sleep 2

PSQL="psql -h /tmp -p $PORT -U postgres" "$HERE/suite.sh"
