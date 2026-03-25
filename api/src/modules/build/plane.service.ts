import { and, desc, eq } from "drizzle-orm";

import type { Database } from "../../db/connection";
import { allocateSlug } from "../../lib/slug";
import {
  artifact,
  componentArtifact,
  moduleVersion,
  repo,
} from "../../db/schema/build";
import { componentSpec, productModule } from "../../db/schema/product";

export type CreateRepoBody = {
  name: string;
  slug?: string | null;
  kind: string;
  teamId: string;
  gitUrl: string;
  defaultBranch: string;
  moduleId?: string | null;
};

export type RegisterVersionBody = {
  version: string;
  compatibilityRange?: string | null;
  schemaVersion?: string | null;
};

export type CreateArtifactBody = {
  imageRef: string;
  imageDigest: string;
  sizeBytes?: number | null;
};

export type LinkComponentArtifactBody = {
  moduleVersionId: string;
  componentId: string;
  artifactId: string;
};

export class BuildPlaneService {
  constructor(private readonly db: Database) {}

  async createRepo(body: CreateRepoBody) {
    const slug = await allocateSlug({
      baseLabel: body.name,
      explicitSlug: body.slug,
      isTaken: async (s) => {
        const [r] = await this.db
          .select()
          .from(repo)
          .where(eq(repo.slug, s))
          .limit(1);
        return r != null;
      },
    });
    const [row] = await this.db
      .insert(repo)
      .values({
        name: body.name,
        slug,
        kind: body.kind,
        teamId: body.teamId,
        gitUrl: body.gitUrl,
        defaultBranch: body.defaultBranch,
        moduleId: body.moduleId ?? null,
      })
      .returning();
    return row;
  }

  async getRepo(repoId: string) {
    const [row] = await this.db
      .select()
      .from(repo)
      .where(eq(repo.repoId, repoId))
      .limit(1);
    return row ?? null;
  }

  async listRepos(q?: { moduleId?: string; limit?: number; offset?: number }) {
    const limit = Math.min(q?.limit ?? 50, 200);
    const offset = q?.offset ?? 0;
    const base = this.db.select().from(repo);
    const rows = q?.moduleId
      ? await base
          .where(eq(repo.moduleId, q.moduleId))
          .orderBy(desc(repo.createdAt))
          .limit(limit)
          .offset(offset)
      : await base.orderBy(desc(repo.createdAt)).limit(limit).offset(offset);
    return { data: rows, total: rows.length };
  }

  async resolveModuleIdByName(name: string): Promise<string | null> {
    const [row] = await this.db
      .select({ moduleId: productModule.moduleId })
      .from(productModule)
      .where(eq(productModule.name, name))
      .limit(1);
    return row?.moduleId ?? null;
  }

  async createModuleVersion(moduleName: string, body: RegisterVersionBody) {
    const moduleId = await this.resolveModuleIdByName(moduleName);
    if (!moduleId) {
      throw new Error(`Module not found: ${moduleName}`);
    }
    const [row] = await this.db
      .insert(moduleVersion)
      .values({
        moduleId,
        version: body.version,
        compatibilityRange: body.compatibilityRange ?? null,
        schemaVersion: body.schemaVersion ?? null,
      })
      .returning();
    return row;
  }

  async listModuleVersions(moduleName: string) {
    const moduleId = await this.resolveModuleIdByName(moduleName);
    if (!moduleId) {
      return { data: [] as (typeof moduleVersion.$inferSelect)[], module: moduleName };
    }
    const rows = await this.db
      .select()
      .from(moduleVersion)
      .where(eq(moduleVersion.moduleId, moduleId))
      .orderBy(desc(moduleVersion.createdAt));
    return { data: rows, module: moduleName };
  }

  async getLatestModuleVersion(moduleName: string) {
    const { data } = await this.listModuleVersions(moduleName);
    return data[0] ?? null;
  }

  async createArtifact(body: CreateArtifactBody) {
    const [row] = await this.db
      .insert(artifact)
      .values({
        imageRef: body.imageRef,
        imageDigest: body.imageDigest,
        sizeBytes: body.sizeBytes ?? null,
      })
      .returning();
    return row;
  }

  async getArtifact(artifactId: string) {
    const [row] = await this.db
      .select()
      .from(artifact)
      .where(eq(artifact.artifactId, artifactId))
      .limit(1);
    return row ?? null;
  }

  async listArtifacts(q?: { limit?: number; offset?: number }) {
    const limit = Math.min(q?.limit ?? 50, 200);
    const offset = q?.offset ?? 0;
    const rows = await this.db
      .select()
      .from(artifact)
      .orderBy(desc(artifact.builtAt))
      .limit(limit)
      .offset(offset);
    return { data: rows, total: rows.length };
  }

  async linkComponentArtifact(body: LinkComponentArtifactBody) {
    const [row] = await this.db
      .insert(componentArtifact)
      .values({
        moduleVersionId: body.moduleVersionId,
        componentId: body.componentId,
        artifactId: body.artifactId,
      })
      .returning();
    return row;
  }

  async getComponentArtifacts(moduleVersionId: string) {
    return this.db
      .select()
      .from(componentArtifact)
      .where(eq(componentArtifact.moduleVersionId, moduleVersionId));
  }

  async resolveComponentId(
    moduleName: string,
    componentName: string
  ): Promise<string | null> {
    const moduleId = await this.resolveModuleIdByName(moduleName);
    if (!moduleId) return null;
    const [row] = await this.db
      .select({ componentId: componentSpec.componentId })
      .from(componentSpec)
      .where(
        and(
          eq(componentSpec.moduleId, moduleId),
          eq(componentSpec.name, componentName)
        )
      )
      .limit(1);
    return row?.componentId ?? null;
  }
}
