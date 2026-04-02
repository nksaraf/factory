-- Phase 0: Port routing infrastructure
-- Adds cluster endpoint, sandbox IP/auth, and forwarded port tracking

-- 0.1: Add endpoint column to cluster (where NodePorts are reachable)
ALTER TABLE factory_infra.cluster ADD COLUMN IF NOT EXISTS endpoint TEXT;

-- 0.2: Add ip_address and auth_mode to sandbox
ALTER TABLE factory_fleet.sandbox ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE factory_fleet.sandbox ADD COLUMN IF NOT EXISTS auth_mode TEXT NOT NULL DEFAULT 'private';
ALTER TABLE factory_fleet.sandbox ADD CONSTRAINT sandbox_auth_mode_valid
  CHECK (auth_mode IN ('public', 'team', 'private'));

-- 0.8: Forwarded port metadata table
CREATE TABLE IF NOT EXISTS factory_fleet.forwarded_port (
  forwarded_port_id  TEXT PRIMARY KEY,
  sandbox_id         TEXT NOT NULL REFERENCES factory_fleet.sandbox(sandbox_id) ON DELETE CASCADE,
  tunnel_id          TEXT,
  port               INTEGER NOT NULL,
  label              TEXT,
  protocol           TEXT NOT NULL DEFAULT 'http',
  is_primary         BOOLEAN NOT NULL DEFAULT false,
  status             TEXT NOT NULL DEFAULT 'active',
  detected_by        TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sandbox_id, port)
);

ALTER TABLE factory_fleet.forwarded_port ADD CONSTRAINT forwarded_port_protocol_valid
  CHECK (protocol IN ('http', 'tcp'));
ALTER TABLE factory_fleet.forwarded_port ADD CONSTRAINT forwarded_port_status_valid
  CHECK (status IN ('active', 'inactive'));

CREATE INDEX IF NOT EXISTS forwarded_port_sandbox_idx ON factory_fleet.forwarded_port(sandbox_id);
