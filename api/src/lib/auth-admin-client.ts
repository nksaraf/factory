import { logger } from "../logger";

/**
 * Client for auth-service admin API (user creation, org membership).
 * Used for auto-provisioning shadow developer accounts from GitHub.
 */
export class AuthAdminClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  async createUser(body: {
    name: string;
    email: string;
    data?: { userType?: string; metadata?: Record<string, unknown> };
  }): Promise<{ id: string } | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/admin/create-user`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        logger.warn(
          { status: res.status, email: body.email },
          "failed to create shadow user",
        );
        return null;
      }
      return await res.json();
    } catch (err) {
      logger.error(
        { err, email: body.email },
        "auth admin client error creating user",
      );
      return null;
    }
  }

  async addOrgMember(body: {
    organizationId: string;
    userId: string;
    role: string;
  }): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.baseUrl}/organization/invite-member`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
        },
      );
      return res.ok;
    } catch (err) {
      logger.error({ err }, "auth admin client error adding org member");
      return false;
    }
  }
}
