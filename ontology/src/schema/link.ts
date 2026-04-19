import type { LinkDefinition } from "./types"

type LinkOpts = Omit<LinkDefinition, "cardinality" | "target">

export const link = {
  manyToOne: (target: string, opts?: Partial<LinkOpts>): LinkDefinition => ({
    cardinality: "many-to-one",
    target,
    ...opts,
  }),
  oneToMany: (target: string, opts?: Partial<LinkOpts>): LinkDefinition => ({
    cardinality: "one-to-many",
    target,
    ...opts,
  }),
  manyToMany: (target: string, opts?: Partial<LinkOpts>): LinkDefinition => ({
    cardinality: "many-to-many",
    target,
    ...opts,
  }),
  oneToOne: (target: string, opts?: Partial<LinkOpts>): LinkDefinition => ({
    cardinality: "one-to-one",
    target,
    ...opts,
  }),
}
