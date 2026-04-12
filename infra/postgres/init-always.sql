-- Idempotent postgres initialization for all dependent services.
-- Runs on every `docker compose up` via the infra-postgres-init sidecar.
-- Safe to re-run — all statements use IF NOT EXISTS / conditional guards.

-- ─── Service Databases ──────────────────────────────────────────

-- SpiceDB authorization database
SELECT 'CREATE DATABASE spicedb'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'spicedb')\gexec

-- Metabase application database (dashboards, questions, users)
SELECT 'CREATE DATABASE metabase'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'metabase')\gexec

-- ─── PowerSync Replication ──────────────────────────────────────

-- Dedicated replication user for PowerSync logical replication
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'powersync_repl') THEN
    CREATE USER powersync_repl WITH REPLICATION PASSWORD 'powersync_repl_pass';
  END IF;
END $$;

-- Grant read access to factory schemas (created by Drizzle migrations)
DO $$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT unnest(ARRAY['org', 'infra', 'build', 'ops', 'software', 'commerce'])
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = s) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO powersync_repl', s);
      EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO powersync_repl', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO powersync_repl', s);
    END IF;
  END LOOP;
END $$;

-- Publication for all tables (PowerSync filters via sync rules)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_publication WHERE pubname = 'powersync_pub') THEN
    CREATE PUBLICATION powersync_pub FOR ALL TABLES;
  END IF;
END $$;
