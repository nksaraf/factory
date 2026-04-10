-- ONE-TIME production fixup: reset factory_migrations to match squashed migrations.
-- Run against: postgresql://postgres:factory-prod-2026@192.168.2.88:54111/postgres
-- BEFORE deploying the new code (or immediately after — setupDb() will skip already-applied migrations).
--
-- After running this, DELETE this file.

BEGIN;
  DELETE FROM public.factory_migrations;
  INSERT INTO public.factory_migrations (hash, created_at) VALUES
    ('d96f7bb01f5d6a1e073ad65f8f0565c674f3a7e91fbf6bda20db58da6e069451', extract(epoch from now()) * 1000),
    ('d9f65b39ea63f34a1ee232739a0973e2ee3800dd8bcad0d980a09b6cfa79510d', extract(epoch from now()) * 1000);
COMMIT;
