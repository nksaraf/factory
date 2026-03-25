import { Elysia } from "elysia";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { FactoryAuthResourceClient } from "../lib/auth-resource-client";

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

/**
 * Permission enforcement middleware.
 *
 * Checks if the authenticated user has a specific permission on a resource
 * by calling the auth-service's resource-permissions check endpoint.
 *
 * Expects `resourceId` in path params and `principal` in context.
 */
export function requirePermission(
  authClient: FactoryAuthResourceClient | null,
  permission: string,
) {
  return new Elysia({ name: `require-${permission}` }).derive(
    async ({
      params,
      principal,
      set,
    }: {
      params: { resourceId?: string };
      principal: string;
      set: { status: number };
    }) => {
      if (!authClient) return {};

      const resourceId = params.resourceId;
      if (!resourceId) return {};

      const allowed = await authClient.checkPermission({
        resourceId,
        permission,
        userId: principal,
      });

      if (!allowed) {
        set.status = 403;
        throw new Error("Forbidden");
      }

      return {};
    },
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
