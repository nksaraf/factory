import { Elysia } from "elysia";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export interface AuthUser {
  id: string;
  email?: string;
  organizationId?: string;
}

/**
 * JWKS-based auth: verifies Bearer JWTs (Better Auth) and exposes user + principal.
 */
export function authPlugin(jwksUrl: string) {
  const jwks = createRemoteJWKSet(new URL(jwksUrl));

  return new Elysia({ name: "auth-plugin" }).derive(
    async ({ headers, set }): Promise<{ user: AuthUser; principal: string }> => {
      const authorization = headers["authorization"];

      if (!authorization) {
        set.status = 401;
        throw new Error("Missing Authorization header");
      }

      const token = authorization.startsWith("Bearer ")
        ? authorization.slice(7)
        : authorization;

      if (!token) {
        set.status = 401;
        throw new Error("Missing bearer token");
      }

      try {
        const { payload } = await jwtVerify(token, jwks);
        const user = extractUser(payload);
        return { user, principal: user.id };
      } catch (err) {
        set.status = 401;
        throw new Error(
          err instanceof Error ? `Invalid token: ${err.message}` : "Invalid token"
        );
      }
    }
  );
}

function extractUser(payload: JWTPayload): AuthUser {
  const id = payload.sub;
  if (!id) {
    throw new Error("Token missing sub claim");
  }

  return {
    id,
    email: payload.email as string | undefined,
    organizationId:
      (payload.org_id as string | undefined) ??
      (payload.organizationId as string | undefined),
  };
}
