-- Custom migration: create host_listening_port view
-- Aggregates port information from multiple sources for port-based entity resolution.

CREATE OR REPLACE VIEW infra.host_listening_port AS

-- 1. Reverse-proxy realm entrypoints (gateways)
SELECT
  rh.host_id,
  (ep_json->>'port')::int AS port,
  COALESCE(ep_json->>'protocol', 'http') AS protocol,
  'realm' AS entity_kind,
  r.id AS entity_id,
  r.slug AS entity_slug,
  r.type AS entity_type,
  TRUE AS is_gateway
FROM infra.realm r
JOIN infra.realm_host rh ON rh.realm_id = r.id
CROSS JOIN LATERAL jsonb_array_elements(r.spec->'entrypoints') AS ep_json
WHERE r.type = 'reverse-proxy'
  AND r.spec->'entrypoints' IS NOT NULL
  AND jsonb_array_length(r.spec->'entrypoints') > 0

UNION ALL

-- 2. Component ports (deployed on host via realm → system_deployment → component_deployment)
SELECT
  rh.host_id,
  (p_json->>'port')::int AS port,
  COALESCE(p_json->>'protocol', 'tcp') AS protocol,
  'component' AS entity_kind,
  c.id AS entity_id,
  c.slug AS entity_slug,
  c.type AS entity_type,
  FALSE AS is_gateway
FROM software.component c
JOIN ops.component_deployment cd ON cd.component_id = c.id
JOIN ops.system_deployment sd ON sd.id = cd.system_deployment_id
JOIN infra.realm_host rh ON rh.realm_id = sd.realm_id
CROSS JOIN LATERAL jsonb_array_elements(c.spec->'ports') AS p_json
WHERE c.spec->'ports' IS NOT NULL
  AND jsonb_array_length(c.spec->'ports') > 0

UNION ALL

-- 3. Scan-discovered ports (from host status, process-level)
SELECT
  h.id AS host_id,
  (p_json->>'port')::int AS port,
  COALESCE(p_json->>'protocol', 'tcp') AS protocol,
  'host' AS entity_kind,
  h.id AS entity_id,
  h.slug AS entity_slug,
  'host' AS entity_type,
  FALSE AS is_gateway
FROM infra.host h
CROSS JOIN LATERAL jsonb_array_elements(h.status->'lastScan'->'ports') AS p_json
WHERE h.status->'lastScan'->'ports' IS NOT NULL
  AND jsonb_array_length(h.status->'lastScan'->'ports') > 0;
