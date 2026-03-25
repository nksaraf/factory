-- Drop the sandboxAccess table; access control is now handled by
-- auth-service resource permissions with parentId-based inheritance.
DROP TABLE IF EXISTS factory_fleet.sandbox_access CASCADE;
