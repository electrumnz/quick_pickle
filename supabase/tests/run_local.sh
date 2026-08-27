#!/usr/bin/env bash
# Apply every migration, in order, to a throwaway local database, then load the
# seed. Any error anywhere aborts (ON_ERROR_STOP + single transaction per file).
#
#   supabase/tests/run_local.sh            # migrations + seed + verify
#   DB=half_sour_ci supabase/tests/run_local.sh
set -euo pipefail

DB="${DB:-half_sour_local}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"
PSQL=(psql -v ON_ERROR_STOP=1 --quiet --no-psqlrc)

echo "==> dropping and recreating database ${DB}"
dropdb --if-exists "$DB"
createdb "$DB"

echo "==> applying local Supabase shim (auth schema + roles)"
"${PSQL[@]}" -d "$DB" -f "$HERE/local_supabase_shim.sql"

echo "==> applying migrations"
for f in "$ROOT"/migrations/*.sql; do
  printf '    %s ... ' "$(basename "$f")"
  "${PSQL[@]}" -d "$DB" --single-transaction -f "$f" >/dev/null
  echo "ok"
done

echo "==> loading seed"
"${PSQL[@]}" -d "$DB" --single-transaction -f "$ROOT/seed.sql" >/dev/null
echo "    seed.sql ... ok"

echo "==> verifying"
"${PSQL[@]}" -d "$DB" -f "$HERE/verify.sql"
