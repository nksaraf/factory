import { Octokit } from "@octokit/rest";
import type { Database } from "../../db/connection";
import { gitHostProvider, gitRepoSync, repo } from "../../db/schema/build";
import { eq } from "drizzle-orm";
import { getGitHostAdapter } from "../../adapters/adapter-registry";
import type { GitHostType } from "../../adapters/git-host-adapter";
import type {
  ReleaseContentConfig,
  ReleaseContentResult,
} from "@smp/factory-shared/release-content-schema";
import { ReleaseContentCollector } from "./collector";
import { ReleaseContentGenerator } from "./generator";
import { ReleaseContentPublisher } from "./publisher";
import { logger } from "../../logger";

/**
 * Parse the credentialsEnc field to extract the token.
 */
function parseToken(credentialsEnc: string | null | undefined): string {
  if (!credentialsEnc) return "";
  const trimmed = credentialsEnc.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      return parsed.token ?? "";
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

/**
 * Parse the credentialsEnc field for adapter config.
 */
function parseCredentials(
  credentialsEnc: string | null | undefined,
): Record<string, string | undefined> {
  if (!credentialsEnc) return {};
  const trimmed = credentialsEnc.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return { token: trimmed };
    }
  }
  return { token: trimmed };
}

/**
 * Orchestrates the release content generation pipeline:
 * 1. Resolve repo + git host provider from the database
 * 2. Collect inputs (commits, PRs, OpenAPI diff, design specs)
 * 3. Generate multi-audience content via LLM
 * 4. Publish as a draft PR
 */
export class ReleaseContentService {
  constructor(private readonly db: Database) {}

  async generateForRelease(
    version: string,
    config: ReleaseContentConfig,
  ): Promise<ReleaseContentResult> {
    const repoFullName = config.repoFullName;
    if (!repoFullName) {
      throw new Error("repoFullName is required in config");
    }

    // 1. Find the repo and its git host provider in the database
    const { octokit, adapter, defaultBranch } =
      await this.resolveGitHost(repoFullName);

    logger.info(
      { version, repoFullName, outputs: config.outputs },
      "Starting release content generation",
    );

    // 2. Collect all inputs
    const collector = new ReleaseContentCollector(octokit);
    const context = await collector.collect(repoFullName, version);

    logger.info(
      {
        commits: context.commits.length,
        prs: context.pullRequests.length,
        hasOpenApiDiff: context.openApiDiff !== null,
        designSpecs: context.designSpecs.length,
      },
      "Collected release context",
    );

    if (context.commits.length === 0 && context.pullRequests.length === 0) {
      throw new Error(
        `No commits or PRs found for version ${version}. ` +
        "Make sure the tag exists and there are changes since the previous tag.",
      );
    }

    // 3. Generate content
    const generator = new ReleaseContentGenerator();
    const content = await generator.generate(context, config);

    if (content.length === 0) {
      throw new Error("No content was generated. Check LLM configuration.");
    }

    logger.info(
      { files: content.map((c) => c.filename) },
      "Generated release content",
    );

    // 4. Publish as a draft PR
    const publisher = new ReleaseContentPublisher(octokit, adapter);
    const result = await publisher.publish(
      repoFullName,
      version,
      content,
      defaultBranch,
    );

    logger.info(
      { prUrl: result.prUrl, prNumber: result.prNumber },
      "Release content published",
    );

    return result;
  }

  /**
   * Resolve the Octokit client and GitHostAdapter for a given repo.
   */
  private async resolveGitHost(repoFullName: string): Promise<{
    octokit: Octokit;
    adapter: ReturnType<typeof getGitHostAdapter>;
    defaultBranch: string;
  }> {
    // Look up the repo via the git repo sync table (which stores externalFullName)
    const [syncRow] = await this.db
      .select()
      .from(gitRepoSync)
      .where(eq(gitRepoSync.externalFullName, repoFullName))
      .limit(1);

    if (!syncRow) {
      throw new Error(
        `Repository "${repoFullName}" not found in git host sync. ` +
        "Make sure it is synced with a git host provider.",
      );
    }

    const [repoRow] = await this.db
      .select()
      .from(repo)
      .where(eq(repo.repoId, syncRow.repoId))
      .limit(1);

    if (!repoRow) {
      throw new Error(
        `Repository record not found for "${repoFullName}".`,
      );
    }

    const [provider] = await this.db
      .select()
      .from(gitHostProvider)
      .where(eq(gitHostProvider.gitHostProviderId, syncRow.gitHostProviderId))
      .limit(1);

    if (!provider) {
      throw new Error(
        `Git host provider not found for repo "${repoFullName}".`,
      );
    }

    const credentials = parseCredentials(provider.credentialsEnc);
    const token = parseToken(provider.credentialsEnc);

    const octokit = new Octokit({
      auth: token,
      ...(provider.apiBaseUrl && provider.apiBaseUrl !== "https://api.github.com"
        ? { baseUrl: provider.apiBaseUrl }
        : {}),
    });

    const adapter = getGitHostAdapter(provider.hostType as GitHostType, {
      ...credentials,
      apiBaseUrl: provider.apiBaseUrl,
    });

    return {
      octokit,
      adapter,
      defaultBranch: repoRow.defaultBranch ?? "main",
    };
  }
}
