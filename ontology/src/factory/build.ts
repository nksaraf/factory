import { z } from "zod"
import { defineEntity, link, Bitemporal, Junction } from "../schema/index"

export const GitHostProvider = defineEntity("gitHostProvider", {
  namespace: "build",
  prefix: "ghp",
  plural: "gitHostProviders",
  description: "Git hosting provider (GitHub, GitLab, Gitea, Bitbucket)",
  spec: z.object({
    apiUrl: z.string().optional(),
    authMode: z.enum(["token", "app", "oauth"]).optional(),
    org: z.string().optional(),
    status: z.enum(["active", "inactive", "error"]).optional(),
  }),
  links: {},
})

export const Repo = defineEntity("repo", {
  namespace: "build",
  prefix: "repo",
  plural: "repos",
  description: "Git repository linked to a system",
  traits: [Bitemporal],
  bitemporal: true,
  spec: z.object({
    url: z.string(),
    defaultBranch: z.string().optional(),
    kind: z.string().optional(),
    description: z.string().optional(),
    language: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "repos",
    }),
    gitHostProvider: link.manyToOne("gitHostProvider", {
      fk: "gitHostProviderId",
      inverse: "repos",
    }),
    team: link.manyToOne("team", {
      fk: "teamId",
      inverse: "repos",
    }),
  },
})

// TODO: pipelineRun needs a slug column
export const PipelineRun = defineEntity("pipelineRun", {
  namespace: "build",
  prefix: "prun",
  plural: "pipelineRuns",
  description: "CI/CD pipeline execution triggered by a commit or webhook",
  spec: z.object({
    trigger: z
      .enum(["push", "pull_request", "manual", "schedule", "tag"])
      .optional(),
    branch: z.string().optional(),
    durationMs: z.number().optional(),
  }),
  links: {
    repo: link.manyToOne("repo", {
      fk: "repoId",
      inverse: "pipelineRuns",
      required: true,
    }),
  },
})

export const WorkTrackerProvider = defineEntity("workTrackerProvider", {
  namespace: "build",
  prefix: "wtp",
  plural: "workTrackerProviders",
  description: "Work tracking provider (Jira, Linear)",
  spec: z.object({
    apiUrl: z.string().optional(),
    status: z.enum(["active", "inactive", "error"]).optional(),
    syncStatus: z.enum(["idle", "syncing", "error"]).optional(),
  }),
  links: {
    team: link.manyToOne("team", {
      fk: "teamId",
      inverse: "workTrackerProviders",
    }),
  },
})

export const WorkTrackerProject = defineEntity("workTrackerProject", {
  namespace: "build",
  prefix: "wtpj",
  plural: "workTrackerProjects",
  description: "Project in a work tracker (Jira project, Linear team)",
  spec: z.object({
    key: z.string().optional(),
    url: z.string().optional(),
    description: z.string().optional(),
  }),
  links: {
    workTrackerProvider: link.manyToOne("workTrackerProvider", {
      fk: "workTrackerProviderId",
      inverse: "projects",
      required: true,
    }),
  },
})

// TODO: workItem needs a slug column
export const WorkItem = defineEntity("workItem", {
  namespace: "build",
  prefix: "wi",
  plural: "workItems",
  description: "Issue or ticket from a work tracker",
  spec: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    priority: z.enum(["critical", "high", "medium", "low", "none"]).optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "workItems",
    }),
    workTrackerProvider: link.manyToOne("workTrackerProvider", {
      fk: "workTrackerProviderId",
      inverse: "workItems",
      required: true,
    }),
  },
})

// TODO: systemVersion needs a slug column
export const SystemVersion = defineEntity("systemVersion", {
  namespace: "build",
  prefix: "sver",
  plural: "systemVersions",
  description: "Versioned release of a system in the build pipeline",
  spec: z.object({
    compatibilityRange: z.string().optional(),
    commitSha: z.string().optional(),
    releaseNotes: z.string().optional(),
  }),
  links: {
    system: link.manyToOne("system", {
      fk: "systemId",
      inverse: "versions",
      required: true,
    }),
  },
})

export const ComponentArtifact = defineEntity("component-artifact", {
  namespace: "build",
  prefix: "cart",
  plural: "componentArtifacts",
  description:
    "Links a system version's component to a specific artifact build",
  traits: [Junction],
  spec: z.object({}),
  links: {
    systemVersion: link.manyToOne("systemVersion", {
      fk: "systemVersionId",
      inverse: "componentArtifacts",
      required: true,
      cascade: "delete",
    }),
    component: link.manyToOne("component", {
      fk: "componentId",
      inverse: "componentArtifacts",
      required: true,
      cascade: "delete",
    }),
    artifact: link.manyToOne("artifact", {
      fk: "artifactId",
      inverse: "componentArtifacts",
      required: true,
      cascade: "delete",
    }),
  },
})
