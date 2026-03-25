CREATE TABLE IF NOT EXISTS factory_build.git_host_provider (
  git_host_provider_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  host_type TEXT NOT NULL,
  api_base_url TEXT NOT NULL,
  auth_mode TEXT NOT NULL,
  credentials_enc TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  team_id TEXT NOT NULL,
  last_sync_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'idle',
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT git_host_provider_host_type_valid CHECK (host_type IN ('github', 'gitlab', 'gitea', 'bitbucket')),
  CONSTRAINT git_host_provider_auth_mode_valid CHECK (auth_mode IN ('pat', 'github_app', 'oauth')),
  CONSTRAINT git_host_provider_status_valid CHECK (status IN ('active', 'inactive', 'error')),
  CONSTRAINT git_host_provider_sync_status_valid CHECK (sync_status IN ('idle', 'syncing', 'error'))
);

CREATE UNIQUE INDEX IF NOT EXISTS git_host_provider_slug_unique ON factory_build.git_host_provider (slug);

ALTER TABLE factory_build.repo ADD COLUMN IF NOT EXISTS git_host_provider_id TEXT REFERENCES factory_build.git_host_provider(git_host_provider_id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS factory_build.github_app_installation (
  installation_id TEXT PRIMARY KEY,
  git_host_provider_id TEXT NOT NULL REFERENCES factory_build.git_host_provider(git_host_provider_id) ON DELETE CASCADE,
  github_app_id TEXT NOT NULL,
  github_installation_id TEXT NOT NULL,
  private_key_enc TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  permissions_granted JSONB DEFAULT '{}',
  account_login TEXT,
  account_type TEXT,
  token_expires_at TIMESTAMPTZ,
  token_cache_enc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS factory_build.webhook_event (
  webhook_event_id TEXT PRIMARY KEY,
  git_host_provider_id TEXT NOT NULL REFERENCES factory_build.git_host_provider(git_host_provider_id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  action TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_event_status_valid CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_event_delivery_unique ON factory_build.webhook_event (git_host_provider_id, delivery_id);

CREATE TABLE IF NOT EXISTS factory_build.git_repo_sync (
  git_repo_sync_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL REFERENCES factory_build.repo(repo_id) ON DELETE CASCADE,
  git_host_provider_id TEXT NOT NULL REFERENCES factory_build.git_host_provider(git_host_provider_id) ON DELETE CASCADE,
  external_repo_id TEXT NOT NULL,
  external_full_name TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT TRUE,
  last_sync_at TIMESTAMPTZ,
  sync_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS git_repo_sync_provider_external_unique ON factory_build.git_repo_sync (git_host_provider_id, external_repo_id);

CREATE TABLE IF NOT EXISTS factory_build.git_user_sync (
  git_user_sync_id TEXT PRIMARY KEY,
  git_host_provider_id TEXT NOT NULL REFERENCES factory_build.git_host_provider(git_host_provider_id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  external_login TEXT NOT NULL,
  auth_user_id TEXT,
  email TEXT,
  name TEXT,
  avatar_url TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS git_user_sync_provider_external_unique ON factory_build.git_user_sync (git_host_provider_id, external_user_id);
