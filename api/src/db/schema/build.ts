import { sql } from "drizzle-orm";
import { bigint, check, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { newId } from "../../lib/id";
import { componentSpec, productModule } from "./product";

export const factoryBuild = pgSchema("factory_build");

export const repo = factoryBuild.table(
  "repo",
  {
    repoId: text("repo_id")
      .primaryKey()
      .$defaultFn(() => newId("repo")),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind").notNull(),
    moduleId: text("module_id").references(() => productModule.moduleId, {
      onDelete: "set null",
    }),
    teamId: text("team_id").notNull(),
    gitUrl: text("git_url").notNull(),
    defaultBranch: text("default_branch").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("repo_name_unique").on(t.name),
    uniqueIndex("repo_slug_unique").on(t.slug),
    check(
      "repo_kind_valid",
      sql`${t.kind} IN ('product-module', 'platform-module', 'library', 'vendor-module', 'client-project', 'infra', 'docs', 'tool')`
    ),
  ]
);

export const moduleVersion = factoryBuild.table(
  "module_version",
  {
    moduleVersionId: text("module_version_id")
      .primaryKey()
      .$defaultFn(() => newId("mv")),
    moduleId: text("module_id")
      .notNull()
      .references(() => productModule.moduleId, { onDelete: "cascade" }),
    version: text("version").notNull(),
    compatibilityRange: text("compatibility_range"),
    schemaVersion: text("schema_version"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("module_version_module_version_unique").on(t.moduleId, t.version),
  ]
);

export const artifact = factoryBuild.table("artifact", {
  artifactId: text("artifact_id")
    .primaryKey()
    .$defaultFn(() => newId("art")),
  kind: text("kind").notNull().default("container_image"),
  imageRef: text("image_ref").notNull(),
  imageDigest: text("image_digest").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  builtAt: timestamp("built_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check(
    "artifact_kind_valid",
    sql`${t.kind} IN ('container_image', 'binary', 'archive', 'package', 'bundle')`
  ),
]);

export const componentArtifact = factoryBuild.table(
  "component_artifact",
  {
    componentArtifactId: text("component_artifact_id")
      .primaryKey()
      .$defaultFn(() => newId("ca")),
    moduleVersionId: text("module_version_id")
      .notNull()
      .references(() => moduleVersion.moduleVersionId, { onDelete: "cascade" }),
    componentId: text("component_id")
      .notNull()
      .references(() => componentSpec.componentId, { onDelete: "cascade" }),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => artifact.artifactId, { onDelete: "cascade" }),
  }
);
