-- Drop restrictive check constraints on provider table to allow
-- free-form provider_type and provider_kind values (e.g. 'local').
ALTER TABLE factory_infra.provider DROP CONSTRAINT IF EXISTS provider_type_valid;
ALTER TABLE factory_infra.provider DROP CONSTRAINT IF EXISTS provider_kind_valid;
ALTER TABLE factory_infra.provider DROP CONSTRAINT IF EXISTS provider_status_valid;
