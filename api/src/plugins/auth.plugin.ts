import { Elysia } from "elysia";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { FactoryAuthzClient } from "../lib/authz-client";
import type { Database } from "../db/connection";
import { IdentityService } from "../modules/identity/identity.service";
import { logger } from "../logger";

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
 * Auto-provisioning plugin: resolves or creates an orgPrincipal for
 * every authenticated request, attaching principalId to context.
 */
export function principalPlugin(db: Database) {
  const identityService = new IdentityService(db);

  return new Elysia({ name: "principal-plugin" }).derive(
    async (ctx): Promise<{ principalId: string }> => {
      const user = (ctx as unknown as { user: AuthUser }).user;
      if (!user?.id) return { principalId: "" };

      try {
        const principal = await identityService.resolveOrCreatePrincipal({
          authUserId: user.id,
          email: user.email,
        });
        return { principalId: principal.id };
      } catch (err) {
        logger.error({ err, authUserId: user.id }, "principal auto-provision failed");
        return { principalId: "" };
      }
    }
  );
}

/**
 * Permission enforcement middleware.
 *
 * Checks if the authenticated user has a specific permission on a resource
 * by calling the auth-service's universal authz check endpoint.
 *
 * Expects `resourceId` (or `id`) in path params and `principal` in context.
 */
export function requirePermission(
  authzClient: FactoryAuthzClient | null,
  resourceType: string,
  action: string,
) {
  return new Elysia({ name: `require-${resourceType}-${action}` }).derive(
    async (context) => {
      if (!authzClient) return {};

      const params = context.params as Record<string, string | undefined>;
      const principal = (context as unknown as { principal: string }).principal;
      const resourceId = params.resourceId ?? params.id;
      if (!resourceId || !principal) return {};

      const allowed = await authzClient.checkPermission({
        principal,
        action,
        resourceType,
        resourceId,
      });

      if (!allowed) {
        context.set.status = 403;
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
