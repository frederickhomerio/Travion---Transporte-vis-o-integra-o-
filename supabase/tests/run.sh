#!/usr/bin/env bash
# Recria um banco local, aplica stub + migrações e roda os testes SQL.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
DB=${DB:-freteiq_test}
PSQL="psql -v ON_ERROR_STOP=1 -q -X"
su postgres -c "dropdb --if-exists $DB" >/dev/null
for r in anon authenticated service_role; do su postgres -c "psql -qXc \"drop role if exists $r\"" >/dev/null 2>&1 || true; done
su postgres -c "createdb $DB"
run() { su postgres -c "$PSQL -d $DB -f '$1'"; }
run "$DIR/tests/00_stub_supabase.sql"
for f in "$DIR"/migrations/*.sql; do echo "migração: $(basename "$f")"; run "$f"; done
for f in "$DIR"/tests/[1-9]*.sql; do echo "teste: $(basename "$f")"; run "$f"; done
echo "OK: todos os testes SQL passaram"
