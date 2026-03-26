/** Organization plane — teams, principals, scopes */

export type TeamType = "team" | "business-unit" | "product-area";

export interface Team {
  teamId: string;
  name: string;
  slug: string;
  type: TeamType;
  parentTeamId?: string | null;
  description?: string | null;
  profile: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type PrincipalType = "user" | "agent" | "service_account";
export type PrincipalStatus = "active" | "suspended" | "deactivated";

export interface Principal {
  principalId: string;
  name: string;
  slug: string;
  type: PrincipalType;
  authUserId?: string | null;
  agentId?: string | null;
  teamId?: string | null;
  email?: string | null;
  profile: Record<string, unknown>;
  status: PrincipalStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type MembershipRole = "member" | "lead" | "admin";

export interface PrincipalTeamMembership {
  membershipId: string;
  principalId: string;
  teamId: string;
  role: MembershipRole;
  createdAt: string;
}

export type ScopeType = "team" | "resource" | "custom";

export interface Scope {
  scopeId: string;
  name: string;
  slug: string;
  type: ScopeType;
  parentScopeId?: string | null;
  teamId?: string | null;
  resourceKind?: string | null;
  resourceId?: string | null;
  description?: string | null;
  createdAt: string;
}

// ─── Identity Link ──────────────────────────────────────────

export type IdentityProvider =
  | "github"
  | "google"
  | "slack"
  | "jira"
  | "claude"
  | "cursor";

export type SyncStatus = "idle" | "syncing" | "error";

export interface IdentityLink {
  identityLinkId: string;
  principalId: string;
  provider: IdentityProvider;
  externalUserId: string;
  externalLogin?: string | null;
  email?: string | null;
  authUserId?: string | null;
  profileData: Record<string, unknown>;
  syncStatus: SyncStatus;
  lastSyncAt?: string | null;
  syncError?: string | null;
  linkedAt: string;
  updatedAt: string;
}

// ─── Tool Credential ────────────────────────────────────────

export type ToolCredentialStatus = "active" | "revoked";

export interface ToolCredential {
  toolCredentialId: string;
  principalId: string;
  provider: string;
  keyName: string;
  keyPrefix: string;
  status: ToolCredentialStatus;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

// ─── Tool Usage ─────────────────────────────────────────────

export interface ToolUsage {
  usageId: string;
  principalId: string;
  tool: string;
  sessionId?: string | null;
  model?: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number | null;
  costMicrodollars: number;
  recordedAt: string;
  metadata: Record<string, unknown>;
}

// ─── Principal Profile ──────────────────────────────────────

export interface PrincipalProfile {
  displayName?: string;
  avatarUrl?: string;
  bio?: string;
  timezone?: string;
  github?: { login: string; avatarUrl: string };
  google?: { name: string; avatarUrl: string };
  slack?: { handle: string; avatarUrl: string; statusText?: string };
  jira?: { accountId: string; displayName: string };
}
