/**
 * PowerSync client-side schema — defines the local SQLite replica structure.
 *
 * Column names must match Postgres column names (snake_case), NOT Drizzle
 * property names (camelCase). PowerSync column types are limited to:
 * text, integer, real.
 *
 * JSON/JSONB columns are stored as text (serialized JSON strings).
 * Booleans are stored as integer (0/1).
 * Timestamps are stored as text (ISO strings).
 * Bigints are stored as text.
 */
import { column, Schema, Table } from "@powersync/web"

// ---------------------------------------------------------------------------
// Fleet domain (factory_fleet)
// ---------------------------------------------------------------------------

const site = new Table({
  name: column.text,
  slug: column.text,
  product: column.text,
  cluster_id: column.text,
  status: column.text,
  created_at: column.text,
  last_checkin_at: column.text,
  current_manifest_version: column.integer,
})

const deployment_target = new Table({
  name: column.text,
  slug: column.text,
  kind: column.text,
  runtime: column.text,
  host_id: column.text,
  vm_id: column.text,
  site_id: column.text,
  cluster_id: column.text,
  namespace: column.text,
  created_by: column.text,
  trigger: column.text,
  ttl: column.text,
  expires_at: column.text,
  tier_policies: column.text,
  status: column.text,
  labels: column.text,
  created_at: column.text,
  destroyed_at: column.text,
})

const workload = new Table({
  deployment_target_id: column.text,
  module_version_id: column.text,
  component_id: column.text,
  artifact_id: column.text,
  replicas: column.integer,
  env_overrides: column.text,
  resource_overrides: column.text,
  status: column.text,
  desired_image: column.text,
  desired_artifact_uri: column.text,
  actual_image: column.text,
  drift_detected: column.integer,
  last_reconciled_at: column.text,
  created_at: column.text,
  updated_at: column.text,
})

const dependency_workload = new Table({
  deployment_target_id: column.text,
  name: column.text,
  slug: column.text,
  image: column.text,
  port: column.integer,
  env: column.text,
  status: column.text,
})

const release = new Table({
  version: column.text,
  status: column.text,
  created_by: column.text,
  created_at: column.text,
})

const release_module_pin = new Table({
  release_id: column.text,
  module_version_id: column.text,
})

const rollout = new Table({
  release_id: column.text,
  deployment_target_id: column.text,
  status: column.text,
  started_at: column.text,
  completed_at: column.text,
})

const sandbox = new Table({
  deployment_target_id: column.text,
  name: column.text,
  slug: column.text,
  runtime_type: column.text,
  vm_id: column.text,
  pod_name: column.text,
  devcontainer_config: column.text,
  devcontainer_image: column.text,
  owner_id: column.text,
  owner_type: column.text,
  setup_progress: column.text,
  status_message: column.text,
  repos: column.text,
  docker_cache_gb: column.integer,
  cpu: column.text,
  memory: column.text,
  storage_gb: column.integer,
  ssh_host: column.text,
  ssh_port: column.integer,
  web_terminal_url: column.text,
  cloned_from_snapshot_id: column.text,
  created_at: column.text,
  updated_at: column.text,
})

const sandbox_template = new Table({
  name: column.text,
  slug: column.text,
  runtime_type: column.text,
  image: column.text,
  default_cpu: column.text,
  default_memory: column.text,
  default_storage_gb: column.integer,
  default_docker_cache_gb: column.integer,
  vm_template_ref: column.text,
  default_ttl_minutes: column.integer,
  pre_installed_tools: column.text,
  description: column.text,
  is_default: column.integer,
  created_at: column.text,
})

const sandbox_snapshot = new Table({
  sandbox_id: column.text,
  name: column.text,
  description: column.text,
  runtime_type: column.text,
  volume_snapshot_name: column.text,
  image_ref: column.text,
  proxmox_snapshot_name: column.text,
  vm_id: column.text,
  snapshot_metadata: column.text,
  size_bytes: column.text,
  status: column.text,
  created_at: column.text,
})

const workload_override = new Table({
  workload_id: column.text,
  field: column.text,
  previous_value: column.text,
  new_value: column.text,
  reason: column.text,
  created_by: column.text,
  created_at: column.text,
  reverted_at: column.text,
  reverted_by: column.text,
})

const intervention = new Table({
  deployment_target_id: column.text,
  workload_id: column.text,
  action: column.text,
  principal_id: column.text,
  reason: column.text,
  details: column.text,
  created_at: column.text,
})

const site_manifest = new Table({
  site_id: column.text,
  manifest_version: column.integer,
  manifest_hash: column.text,
  release_id: column.text,
  content: column.text,
  created_at: column.text,
})

const install_manifest = new Table({
  site_id: column.text,
  manifest_version: column.integer,
  role: column.text,
  dx_version: column.text,
  install_mode: column.text,
  k3s_version: column.text,
  helm_chart_version: column.text,
  site_name: column.text,
  domain: column.text,
  enabled_planes: column.text,
  nodes: column.text,
  upgrades: column.text,
  raw_manifest: column.text,
  reported_at: column.text,
  created_at: column.text,
  updated_at: column.text,
})

const release_bundle = new Table({
  release_id: column.text,
  role: column.text,
  arch: column.text,
  dx_version: column.text,
  k3s_version: column.text,
  helm_chart_version: column.text,
  image_count: column.integer,
  size_bytes: column.text,
  checksum_sha256: column.text,
  storage_path: column.text,
  status: column.text,
  created_by: column.text,
  created_at: column.text,
  completed_at: column.text,
})

const connection_audit_event = new Table({
  principal_id: column.text,
  deployment_target_id: column.text,
  connected_resources: column.text,
  readonly: column.integer,
  started_at: column.text,
  ended_at: column.text,
  reason: column.text,
})

// ---------------------------------------------------------------------------
// Product domain (factory_product)
// ---------------------------------------------------------------------------

const module = new Table({
  name: column.text,
  slug: column.text,
  team: column.text,
  product: column.text,
  lifecycle_state: column.text,
  created_at: column.text,
})

const component_spec = new Table({
  module_id: column.text,
  name: column.text,
  slug: column.text,
  kind: column.text,
  ports: column.text,
  healthcheck: column.text,
  is_public: column.integer,
  stateful: column.integer,
  run_order: column.integer,
  default_replicas: column.integer,
  default_cpu: column.text,
  default_memory: column.text,
  created_at: column.text,
})

const work_tracker_provider = new Table({
  name: column.text,
  slug: column.text,
  kind: column.text,
  api_url: column.text,
  // credentials_ref excluded (sensitive)
  default_project_key: column.text,
  status: column.text,
  sync_enabled: column.integer,
  sync_interval_minutes: column.integer,
  sync_status: column.text,
  last_sync_at: column.text,
  sync_error: column.text,
  created_at: column.text,
})

const work_tracker_project_mapping = new Table({
  work_tracker_provider_id: column.text,
  module_id: column.text,
  external_project_id: column.text,
  external_project_name: column.text,
  sync_direction: column.text,
  filter_query: column.text,
  created_at: column.text,
})

const work_item = new Table({
  module_id: column.text,
  title: column.text,
  status: column.text,
  kind: column.text,
  priority: column.text,
  description: column.text,
  labels: column.text,
  parent_work_item_id: column.text,
  assignee: column.text,
  external_id: column.text,
  external_key: column.text,
  external_url: column.text,
  work_tracker_provider_id: column.text,
  created_at: column.text,
  updated_at: column.text,
})

// ---------------------------------------------------------------------------
// Build domain (factory_build)
// ---------------------------------------------------------------------------

const git_host_provider = new Table({
  name: column.text,
  slug: column.text,
  host_type: column.text,
  api_base_url: column.text,
  auth_mode: column.text,
  // credentials_enc excluded (sensitive)
  status: column.text,
  team_id: column.text,
  last_sync_at: column.text,
  sync_status: column.text,
  sync_error: column.text,
  created_at: column.text,
})

const repo = new Table({
  name: column.text,
  slug: column.text,
  kind: column.text,
  module_id: column.text,
  git_host_provider_id: column.text,
  team_id: column.text,
  git_url: column.text,
  default_branch: column.text,
  created_at: column.text,
})

const module_version = new Table({
  module_id: column.text,
  version: column.text,
  compatibility_range: column.text,
  schema_version: column.text,
  created_at: column.text,
})

const artifact = new Table({
  kind: column.text,
  image_ref: column.text,
  image_digest: column.text,
  size_bytes: column.text,
  built_at: column.text,
})

const component_artifact = new Table({
  module_version_id: column.text,
  component_id: column.text,
  artifact_id: column.text,
})

const webhook_event = new Table({
  git_host_provider_id: column.text,
  delivery_id: column.text,
  event_type: column.text,
  action: column.text,
  // payload excluded (can be very large)
  status: column.text,
  error_message: column.text,
  processed_at: column.text,
  created_at: column.text,
})

const git_repo_sync = new Table({
  repo_id: column.text,
  git_host_provider_id: column.text,
  external_repo_id: column.text,
  external_full_name: column.text,
  is_private: column.integer,
  last_sync_at: column.text,
  sync_error: column.text,
  created_at: column.text,
})

const git_user_sync = new Table({
  git_host_provider_id: column.text,
  external_user_id: column.text,
  external_login: column.text,
  auth_user_id: column.text,
  email: column.text,
  name: column.text,
  avatar_url: column.text,
  synced_at: column.text,
})

// ---------------------------------------------------------------------------
// Infra domain (factory_infra)
// ---------------------------------------------------------------------------

const provider = new Table({
  name: column.text,
  slug: column.text,
  provider_type: column.text,
  url: column.text,
  status: column.text,
  // credentials_ref excluded (sensitive)
  provider_kind: column.text,
  created_at: column.text,
})

const cluster = new Table({
  name: column.text,
  slug: column.text,
  provider_id: column.text,
  status: column.text,
  // kubeconfig_ref excluded (sensitive)
  created_at: column.text,
})

const region = new Table({
  name: column.text,
  display_name: column.text,
  slug: column.text,
  country: column.text,
  city: column.text,
  timezone: column.text,
  provider_id: column.text,
  created_at: column.text,
})

const datacenter = new Table({
  name: column.text,
  display_name: column.text,
  slug: column.text,
  region_id: column.text,
  availability_zone: column.text,
  address: column.text,
  created_at: column.text,
})

const host = new Table({
  name: column.text,
  slug: column.text,
  hostname: column.text,
  provider_id: column.text,
  datacenter_id: column.text,
  ip_address: column.text,
  ipmi_address: column.text,
  status: column.text,
  os_type: column.text,
  access_method: column.text,
  cpu_cores: column.integer,
  memory_mb: column.integer,
  disk_gb: column.integer,
  rack_location: column.text,
  created_at: column.text,
})

const proxmox_cluster = new Table({
  name: column.text,
  slug: column.text,
  provider_id: column.text,
  api_host: column.text,
  api_port: column.integer,
  // token_id, token_secret excluded (sensitive)
  ssl_fingerprint: column.text,
  sync_status: column.text,
  last_sync_at: column.text,
  sync_error: column.text,
  created_at: column.text,
})

const vm = new Table({
  name: column.text,
  slug: column.text,
  provider_id: column.text,
  datacenter_id: column.text,
  host_id: column.text,
  cluster_id: column.text,
  proxmox_cluster_id: column.text,
  proxmox_vmid: column.integer,
  vm_type: column.text,
  status: column.text,
  os_type: column.text,
  access_method: column.text,
  access_user: column.text,
  cpu: column.integer,
  memory_mb: column.integer,
  disk_gb: column.integer,
  ip_address: column.text,
  created_at: column.text,
})

const kube_node = new Table({
  name: column.text,
  slug: column.text,
  cluster_id: column.text,
  vm_id: column.text,
  role: column.text,
  status: column.text,
  ip_address: column.text,
  created_at: column.text,
})

const subnet = new Table({
  cidr: column.text,
  gateway: column.text,
  netmask: column.text,
  vlan_id: column.integer,
  vlan_name: column.text,
  datacenter_id: column.text,
  subnet_type: column.text,
  description: column.text,
  dns_servers: column.text,
  dns_domain: column.text,
  created_at: column.text,
})

const ip_address = new Table({
  address: column.text,
  subnet_id: column.text,
  assigned_to_type: column.text,
  assigned_to_id: column.text,
  status: column.text,
  hostname: column.text,
  fqdn: column.text,
  purpose: column.text,
  created_at: column.text,
})

// ---------------------------------------------------------------------------
// Commerce domain (factory_commerce)
// ---------------------------------------------------------------------------

const customer_account = new Table({
  name: column.text,
  slug: column.text,
  status: column.text,
  created_at: column.text,
})

const plan = new Table({
  name: column.text,
  slug: column.text,
  included_modules: column.text,
  created_at: column.text,
})

const entitlement = new Table({
  customer_id: column.text,
  module_id: column.text,
  status: column.text,
  quotas: column.text,
  expires_at: column.text,
  site_id: column.text,
  created_at: column.text,
})

const entitlement_bundle = new Table({
  customer_id: column.text,
  site_id: column.text,
  payload: column.text,
  signature: column.text,
  issued_at: column.text,
  expires_at: column.text,
  grace_period_days: column.integer,
})

// ---------------------------------------------------------------------------
// Agent domain (factory_agent)
// ---------------------------------------------------------------------------

const agent = new Table({
  name: column.text,
  slug: column.text,
  agent_type: column.text,
  status: column.text,
  capabilities: column.text,
  created_at: column.text,
})

const agent_execution = new Table({
  agent_id: column.text,
  task: column.text,
  status: column.text,
  cost_cents: column.integer,
  started_at: column.text,
  completed_at: column.text,
})

// ---------------------------------------------------------------------------
// Schema registry
// ---------------------------------------------------------------------------

export const AppSchema = new Schema({
  // Fleet
  site,
  deployment_target,
  workload,
  dependency_workload,
  release,
  release_module_pin,
  rollout,
  sandbox,
  sandbox_template,
  sandbox_snapshot,
  workload_override,
  intervention,
  site_manifest,
  install_manifest,
  release_bundle,
  connection_audit_event,

  // Product
  module,
  component_spec,
  work_tracker_provider,
  work_tracker_project_mapping,
  work_item,

  // Build
  git_host_provider,
  repo,
  module_version,
  artifact,
  component_artifact,
  webhook_event,
  git_repo_sync,
  git_user_sync,

  // Infra
  provider,
  cluster,
  region,
  datacenter,
  host,
  proxmox_cluster,
  vm,
  kube_node,
  subnet,
  ip_address,

  // Commerce
  customer_account,
  plan,
  entitlement,
  entitlement_bundle,

  // Agent
  agent,
  agent_execution,
})

export type AppDatabase = (typeof AppSchema)["types"]
