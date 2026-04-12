-- Custom SQL migration file, put your code below! --
-- Migrate existing JSONB assignment data to columns
UPDATE "infra"."ip_address"
  SET "assigned_to_kind" = spec->>'assignedToType',
      "assigned_to_id" = spec->>'assignedToId'
  WHERE spec->>'assignedToId' IS NOT NULL;
