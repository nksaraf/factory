import { eq } from "drizzle-orm";
import type { Database } from "../../db/connection";
import { identityLink } from "../../db/schema/org";
import { IdentityService } from "./identity.service";
import { logger } from "../../logger";

/**
 * Orchestrates periodic profile sync from identity providers.
 * Pulls fresh profile data for each identity_link with a valid token,
 * then triggers a profile merge on the associated principal.
 */
export class IdentitySyncService {
  private readonly identityService: IdentityService;

  constructor(private readonly db: Database) {
    this.identityService = new IdentityService(db);
  }

  async syncAllIdentities(): Promise<void> {
    const links = await this.db
      .select()
      .from(identityLink)
      .where(eq(identityLink.syncStatus, "idle"));

    if (links.length === 0) return;

    logger.info(
      { count: links.length },
      "syncing identity links",
    );

    // Group by principal so we only merge once per principal
    const principalIds = new Set<string>();

    for (const link of links) {
      try {
        // Mark as syncing
        await this.db
          .update(identityLink)
          .set({ syncStatus: "syncing" })
          .where(eq(identityLink.identityLinkId, link.identityLinkId));

        // Provider-specific sync would go here:
        // - GitHub: fetch user profile via API
        // - Google: profile comes from OAuth, minimal sync
        // - Slack: fetch user info via Web API
        // - Jira: fetch user profile via REST API
        // For now, just mark as synced with existing data.

        await this.db
          .update(identityLink)
          .set({
            syncStatus: "idle",
            lastSyncAt: new Date(),
            syncError: null,
          })
          .where(eq(identityLink.identityLinkId, link.identityLinkId));

        principalIds.add(link.principalId);
      } catch (err) {
        logger.error(
          {
            err,
            identityLinkId: link.identityLinkId,
            provider: link.provider,
          },
          "identity link sync failed",
        );
        await this.db
          .update(identityLink)
          .set({
            syncStatus: "error",
            syncError: err instanceof Error ? err.message : "unknown error",
          })
          .where(eq(identityLink.identityLinkId, link.identityLinkId));
      }
    }

    // Refresh merged profiles for affected principals
    for (const principalId of principalIds) {
      try {
        await this.identityService.refreshPrincipalProfile(principalId);
      } catch (err) {
        logger.error(
          { err, principalId },
          "profile merge failed after identity sync",
        );
      }
    }
  }
}
