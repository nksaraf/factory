import { z } from "zod"
import { defineEntity, link, Junction } from "../schema/index"

export const Team = defineEntity("team", {
  namespace: "org",
  prefix: "team",
  description: "Organizational unit that owns resources and receives secrets",
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    description: z.string().optional(),
    slackChannel: z.string().optional(),
    oncallUrl: z.string().optional(),
  }),
  links: {
    parent: link.manyToOne("team", {
      fk: "parentTeamId",
      inverse: "children",
      description: "Recursive parent for team hierarchy",
    }),
    memberships: link.oneToMany("membership", {
      targetFk: "teamId",
      description: "Team memberships — traverse to reach principals",
    }),
  },
})

export const Principal = defineEntity("principal", {
  namespace: "org",
  prefix: "prin",
  plural: "principals",
  description: "A human or machine identity that can authenticate",
  bitemporal: true,
  metadata: "standard",
  spec: z.object({
    authUserId: z.string(),
    avatarUrl: z.string().optional(),
    email: z.string(),
    displayName: z.string(),
    status: z.enum(["active", "inactive", "suspended"]),
  }),
  links: {
    primaryTeam: link.manyToOne("team", {
      fk: "primaryTeamId",
      inverse: "members",
    }),
  },
})

export const Agent = defineEntity("agent", {
  namespace: "org",
  prefix: "agt",
  plural: "agents",
  description:
    "Persistent AI actor identity with role type and reporting hierarchy",
  metadata: "standard",
  spec: z.object({
    autonomyLevel: z
      .enum(["observer", "advisor", "executor", "operator", "supervisor"])
      .optional(),
    relationship: z.enum(["personal", "team", "org"]).optional(),
    collaborationMode: z.enum(["solo", "pair", "crew", "hierarchy"]).optional(),
    systemPrompt: z.string().optional(),
    model: z.string().optional(),
  }),
  links: {
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "agents",
      required: true,
    }),
    reportsTo: link.manyToOne("agent", {
      fk: "reportsToAgentId",
      inverse: "directReports",
    }),
  },
})

export const Scope = defineEntity("scope", {
  namespace: "org",
  prefix: "scope",
  plural: "scopes",
  description: "Authorization scope: team-derived, resource-level, or custom",
  spec: z.object({
    description: z.string().optional(),
    permissions: z.array(z.string()).optional(),
  }),
  links: {
    team: link.manyToOne("team", {
      fk: "teamId",
      inverse: "scopes",
    }),
  },
})

export const IdentityLink = defineEntity("identityLink", {
  namespace: "org",
  prefix: "idlk",
  plural: "identityLinks",
  description:
    "Links a principal to an external identity provider (GitHub, Slack, etc.)",
  spec: z.object({
    externalUsername: z.string().optional(),
    scopes: z.array(z.string()).optional(),
    syncStatus: z.enum(["idle", "syncing", "error"]).optional(),
  }),
  links: {
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "identityLinks",
      required: true,
    }),
  },
})

// TODO: channel needs a slug column
export const Channel = defineEntity("channel", {
  namespace: "org",
  prefix: "chan",
  plural: "channels",
  description:
    "Persistent surface where threads live (IDE, Slack, terminal, PR, etc.)",
  spec: z.object({
    description: z.string().optional(),
    defaultAgentId: z.string().optional(),
    messagingProviderId: z.string().optional(),
    isDefault: z.boolean().optional(),
  }),
  links: {},
})

// TODO: thread needs a slug column
export const Thread = defineEntity("thread", {
  namespace: "org",
  prefix: "thrd",
  plural: "threads",
  description:
    "Universal conversation primitive: IDE sessions, chats, terminal sessions, reviews, autonomous work",
  spec: z.object({
    title: z.string().optional(),
    model: z.string().optional(),
    cwd: z.string().optional(),
    gitRemoteUrl: z.string().optional(),
    turnCount: z.number().optional(),
  }),
  links: {
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "threads",
    }),
    agent: link.manyToOne("agent", {
      fk: "agentId",
      inverse: "threads",
    }),
    channel: link.manyToOne("channel", {
      fk: "channelId",
      inverse: "threads",
    }),
    parent: link.manyToOne("thread", {
      fk: "parentThreadId",
      inverse: "childThreads",
    }),
  },
})

export const Document = defineEntity("document", {
  namespace: "org",
  prefix: "doc",
  plural: "documents",
  description: "Stored document: plans, PRDs, HLDs, LLDs, ADRs, decks, etc.",
  spec: z.object({
    tags: z.array(z.string()).optional(),
    project: z.string().optional(),
    description: z.string().optional(),
  }),
  links: {
    thread: link.manyToOne("thread", {
      fk: "threadId",
      inverse: "documents",
    }),
    channel: link.manyToOne("channel", {
      fk: "channelId",
      inverse: "documents",
    }),
  },
})

// TODO: event needs a slug column
export const Event = defineEntity("event", {
  namespace: "org",
  prefix: "evt",
  plural: "events",
  description:
    "Universal event log — all producers write canonical events here",
  spec: z.object({
    title: z.string().optional(),
    summary: z.string().optional(),
    payload: z.record(z.unknown()).optional(),
  }),
  links: {
    parentEvent: link.manyToOne("event", {
      fk: "parentEventId",
      inverse: "childEvents",
    }),
  },
})

export const EventSubscription = defineEntity("eventSubscription", {
  namespace: "org",
  prefix: "esub",
  plural: "eventSubscriptions",
  description:
    "Subscription to events — covers workflow triggers and notification streams",
  spec: z.object({
    muted: z.boolean().optional(),
    timezone: z.string().optional(),
  }),
  links: {},
})

export const ConfigVar = defineEntity("configVar", {
  namespace: "org",
  prefix: "cvar",
  plural: "configVars",
  description: "Plain-text configuration variable, scoped to an entity",
  spec: z.object({
    description: z.string().optional(),
    sensitive: z.boolean().optional(),
  }),
  links: {},
})

export const OrgSecret = defineEntity("orgSecret", {
  namespace: "org",
  prefix: "sec",
  plural: "orgSecrets",
  description: "Encrypted secret stored with envelope encryption",
  spec: z.object({
    description: z.string().optional(),
    rotationPolicy: z.enum(["manual", "30d", "90d", "365d"]).optional(),
  }),
  links: {
    createdBy: link.manyToOne("principal", {
      fk: "createdBy",
      inverse: "createdSecrets",
    }),
  },
})

export const Membership = defineEntity("membership", {
  namespace: "org",
  prefix: "ptm",
  plural: "memberships",
  description: "Links a principal to a team with a role",
  traits: [Junction],
  spec: z.object({
    role: z.enum(["member", "lead", "admin"]).default("member"),
  }),
  links: {
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "memberships",
      required: true,
      cascade: "delete",
    }),
    team: link.manyToOne("team", {
      fk: "teamId",
      inverse: "memberships",
      required: true,
      cascade: "delete",
    }),
  },
})

export const ThreadParticipant = defineEntity("thread-participant", {
  namespace: "org",
  prefix: "tprt",
  plural: "threadParticipants",
  description:
    "Links a principal to a thread with a role and join/leave lifecycle",
  traits: [Junction],
  spec: z.object({
    role: z.string(),
    joinedAt: z.string().optional(),
    leftAt: z.string().optional(),
  }),
  links: {
    thread: link.manyToOne("thread", {
      fk: "threadId",
      inverse: "participants",
      required: true,
      cascade: "delete",
    }),
    principal: link.manyToOne("principal", {
      fk: "principalId",
      inverse: "threadParticipations",
      required: true,
      cascade: "delete",
    }),
  },
})

export const ThreadChannel = defineEntity("thread-channel", {
  namespace: "org",
  prefix: "tc",
  plural: "threadChannels",
  description: "Links a thread to additional channels (surfaces) for mirroring",
  traits: [Junction],
  spec: z.object({
    role: z.string().optional(),
    status: z.enum(["connected", "detached", "paused"]).optional(),
  }),
  links: {
    thread: link.manyToOne("thread", {
      fk: "threadId",
      inverse: "threadChannels",
      required: true,
      cascade: "delete",
    }),
    channel: link.manyToOne("channel", {
      fk: "channelId",
      inverse: "threadChannels",
      required: true,
      cascade: "delete",
    }),
  },
})
