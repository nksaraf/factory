import type { TraitDefinition } from "./types"

export function defineTrait(
  name: string,
  def: Omit<TraitDefinition, "name">
): TraitDefinition {
  return { name, ...def }
}

// --- Built-in traits ---

export const Reconcilable = defineTrait("reconcilable", {
  description:
    "Kubernetes-style spec/status convergence with generation tracking",
  derived: {
    isConverged: {
      type: "boolean",
      computation: {
        kind: "expr",
        fn: (e: any) => e.generation === e.observedGeneration,
      },
    },
    isDrifted: {
      type: "boolean",
      computation: {
        kind: "expr",
        fn: (e: any) => e.generation !== e.observedGeneration,
      },
    },
  },
})

export const Bitemporal = defineTrait("bitemporal", {
  description: "Bi-temporal tracking for audit and time-travel queries",
})

export const TeamOwned = defineTrait("team-owned", {
  description: "Entity owned by a team",
  links: {
    ownerTeam: {
      cardinality: "many-to-one",
      target: "team",
      fk: "ownerTeamId",
      inverse: "ownedResources",
    },
  },
})

export const Lifecycled = defineTrait("lifecycled", {
  description: "Entity with a lifecycle stage",
})

export const Addressable = defineTrait("addressable", {
  description: "Entity reachable via network routes",
  links: {
    routes: {
      cardinality: "one-to-many",
      target: "route",
      targetFk: "targetEntityId",
      polymorphic: { kindColumn: "targetEntityKind" },
    },
  },
})
