import type {
  IdentityProviderAdapter,
  IdentityProviderConfig,
  ExternalIdentityUser,
} from "./identity-provider-adapter"

/**
 * Google identity provider adapter.
 *
 * Google users are created via OAuth login — there is no bulk discovery
 * (that requires Google Workspace Admin SDK). This adapter only supports
 * single-user profile refresh via the userinfo endpoint.
 *
 * Token refresh: if the access token is expired, the caller (sync service)
 * should refresh it via the refresh token before calling this adapter.
 *
 * API endpoints used:
 * - fetchUserProfile: Google OAuth2 userinfo (see `fetch` URL below; path is defined by Google).
 */
export class GoogleIdentityProviderAdapter implements IdentityProviderAdapter {
  readonly provider = "google" as const

  /**
   * No bulk discovery — Google users are linked via OAuth login flow.
   * Returns empty array.
   */
  async fetchUsers(
    _config: IdentityProviderConfig
  ): Promise<ExternalIdentityUser[]> {
    return []
  }

  async fetchUserProfile(
    config: IdentityProviderConfig,
    _externalUserId: string
  ): Promise<ExternalIdentityUser | null> {
    try {
      const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${config.token}` },
      })

      if (!res.ok) return null

      const data = (await res.json()) as GoogleUserInfo

      return {
        externalUserId: data.id,
        email: data.email ?? null,
        login: data.email ?? null,
        displayName: data.name ?? null,
        avatarUrl: data.picture ?? null,
        bio: null,
        profileData: {
          name: data.name,
          givenName: data.given_name,
          familyName: data.family_name,
          picture: data.picture,
          locale: data.locale,
          hd: data.hd,
        },
        isBot: false,
        deleted: false,
      }
    } catch {
      return null
    }
  }
}

// ── Google userinfo response ───────────────────────────────────

interface GoogleUserInfo {
  id: string
  email?: string
  verified_email?: boolean
  name?: string
  given_name?: string
  family_name?: string
  picture?: string
  locale?: string
  hd?: string // hosted domain (Google Workspace)
}

/**
 * Refresh a Google OAuth access token using a refresh token.
 * Returns the new access token and its expiry timestamp.
 *
 * Called by the sync service before invoking fetchUserProfile when
 * the existing access token has expired.
 */
export async function refreshGoogleAccessToken(opts: {
  refreshToken: string
  clientId: string
  clientSecret: string
}): Promise<{ accessToken: string; expiresAt: Date }> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google token refresh failed: ${res.status} ${text}`)
  }

  const data = (await res.json()) as {
    access_token: string
    expires_in: number
  }
  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  }
}
