-- Custom SQL migration file, put your code below! --
-- Rename runtime "compose" → "docker-compose" in system_deployment JSONB specs.
-- Rename realmType "docker" → "docker-compose" in host scan results stored on hosts.

UPDATE ops.system_deployment
SET spec = jsonb_set(spec, '{runtime}', '"docker-compose"')
WHERE spec ->> 'runtime' = 'compose';

UPDATE infra.host
SET spec = jsonb_set(spec, '{lastScanResult}',
  (
    SELECT jsonb_set(
      COALESCE(spec -> 'lastScanResult', '{}'::jsonb),
      '{services}',
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN svc ->> 'realmType' = 'docker'
              THEN jsonb_set(svc, '{realmType}', '"docker-compose"')
              ELSE svc
            END
          )
          FROM jsonb_array_elements(spec -> 'lastScanResult' -> 'services') AS svc
        ),
        '[]'::jsonb
      )
    )
  )
)
WHERE spec -> 'lastScanResult' -> 'services' IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(spec -> 'lastScanResult' -> 'services') AS svc
    WHERE svc ->> 'realmType' = 'docker'
  );
