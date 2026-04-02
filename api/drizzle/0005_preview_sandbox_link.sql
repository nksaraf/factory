-- Phase 1: Link preview to sandbox (build environment)
-- Adds sandbox_id (build sandbox) and image_ref (built container image) to preview

ALTER TABLE factory_fleet.preview ADD COLUMN IF NOT EXISTS sandbox_id TEXT REFERENCES factory_fleet.sandbox(sandbox_id) ON DELETE SET NULL;
ALTER TABLE factory_fleet.preview ADD COLUMN IF NOT EXISTS image_ref TEXT;
