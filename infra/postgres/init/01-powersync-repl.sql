-- PowerSync replication setup
-- Creates a dedicated replication user and publication for PowerSync logical replication.

CREATE USER powersync_repl WITH REPLICATION PASSWORD 'powersync_repl_pass';

-- Grant read access to all factory schemas (v1 legacy + v2 ontology)
DO $$
DECLARE
  s TEXT;
BEGIN
  FOR s IN
    SELECT unnest(ARRAY[
      -- v2 ontology schemas
      'org', 'infra', 'build', 'ops', 'software', 'commerce',
      -- v1 legacy schemas (kept for migration compatibility)
      'factory_product', 'factory_build', 'factory_fleet',
      'factory_infra', 'factory_commerce', 'factory_agent'
    ])
  LOOP
    -- Schema may not exist yet (created by Drizzle migrations).
    -- Grant when it does; skip gracefully when it doesn't.
    IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = s) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO powersync_repl', s);
      EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO powersync_repl', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT TO powersync_repl', s);
    END IF;
  END LOOP;
END
$$;

-- Publication for all tables (PowerSync will filter via sync rules)
CREATE PUBLICATION powersync_pub FOR ALL TABLES;
