import { Elysia } from "elysia";
import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS_URL = process.env.AUTH_JWKS_URL;

const jwks = JWKS_URL ? createRemoteJWKSet(new URL(JWKS_URL)) : null;

export const authPlugin = new Elysia({ name: "auth" }).derive(
  async ({ headers }) => {
    const authorization = headers["authorization"];
    if (!authorization?.startsWith("Bearer ")) {
      return { user: null };
    }

    const token = authorization.slice(7);

    if (!jwks) {
      return { user: null };
    }

    try {
      const { payload } = await jwtVerify(token, jwks);
      return { user: payload };
    } catch {
      return { user: null };
    }
  },
);
