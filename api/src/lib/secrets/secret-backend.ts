/**
 * Secret backend interface.
 *
 * Postgres implementation is the default. The interface exists so that
 * external vault backends (HashiCorp Vault, AWS Secrets Manager, etc.)
 * can be plugged in later without changing callers.
 */

export interface SecretEntry {
  key: string
  value: string // plaintext (decrypted by backend)
}

export interface SetSecretParams {
  key: string
  value: string
  scopeType: string
  scopeId?: string | null
  environment?: string | null
  createdBy?: string | null
}

export interface GetSecretParams {
  key: string
  scopeType: string
  scopeId?: string | null
  environment?: string | null
}

export interface ListSecretsParams {
  scopeType: string
  scopeId?: string | null
  environment?: string | null
}

export interface ListSecretEntry {
  key: string
  scopeType: string
  scopeId: string | null
  environment: string | null
  updatedAt: Date
}

export interface ResolveSecretsParams {
  teamId?: string | null
  projectId?: string | null
  environment?: string | null
}

export interface SecretBackend {
  set(params: SetSecretParams): Promise<void>
  get(params: GetSecretParams): Promise<string | null>
  list(params: ListSecretsParams): Promise<ListSecretEntry[]>
  remove(params: GetSecretParams): Promise<boolean>
  /** Resolve all secrets for a context, applying hierarchy precedence. */
  resolve(params: ResolveSecretsParams): Promise<SecretEntry[]>
}
