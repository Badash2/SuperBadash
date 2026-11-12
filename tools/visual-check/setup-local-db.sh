#!/usr/bin/env bash
# A local Postgres that mimics Supabase (roles anon/authenticated, auth.jwt(), Realtime publication),
# loaded with today's real data. Idempotent - safe to run again.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=sbsupa

service postgresql start >/dev/null 2>&1 || true
for i in $(seq 1 20); do pg_isready -q && break; sleep 1; done

su postgres -c "psql -qv ON_ERROR_STOP=1" <<SQL
DO \$\$ BEGIN CREATE ROLE sb LOGIN SUPERUSER PASSWORD 'sb'; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
DO \$\$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;
SELECT 'CREATE DATABASE $DB OWNER sb' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB')\gexec
SQL

su postgres -c "psql -q -d $DB" <<'SQL'
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
DO $$ BEGIN CREATE PUBLICATION supabase_realtime; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
SQL

cd "$ROOT"
export DATABASE_URL="postgresql://sb:sb@localhost/$DB"
superbadash migrate
superbadash ingest
superbadash publish-deals
echo "local DB ready: $DATABASE_URL"
