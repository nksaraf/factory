import type { FactoryAuthResourceClient } from "./auth-resource-client"
import { logger } from "../logger"

/**
 * @deprecated IAM registry bootstrap is now owned by auth-service's
 * `bootstrapIamRegistry()`. This file is no longer called from factory.api.ts.
 */

const FACTORY_RESOURCE_TYPES = [
  { name: "team", displayName: "Team", allowedPermissions: ["manage", "read"] },
  {
    name: "provider",
    displayName: "Provider",
    allowedPermissions: ["create", "read", "update", "delete"],
  },
  {
    name: "cluster",
    displayName: "Cluster",
    allowedPermissions: ["create", "read", "update", "delete", "provision"],
  },
  {
    name: "region",
    displayName: "Region",
    allowedPermissions: ["create", "read", "update", "delete"],
  },
  {
    name: "vm",
    displayName: "VM",
    allowedPermissions: ["create", "read", "update", "delete", "start", "stop"],
  },
  {
    name: "site",
    displayName: "Site",
    allowedPermissions: ["create", "read", "update", "delete", "deploy"],
  },
  {
    name: "deploymentTarget",
    displayName: "Deployment Target",
    allowedPermissions: [
      "create",
      "read",
      "update",
      "delete",
      "deploy",
      "rollback",
    ],
  },
  {
    name: "sandbox",
    displayName: "Sandbox",
    allowedPermissions: ["create", "read", "update", "delete", "connect"],
  },
  {
    name: "release",
    displayName: "Release",
    allowedPermissions: ["create", "read", "update", "delete", "promote"],
  },
  {
    name: "productModule",
    displayName: "Product Module",
    allowedPermissions: ["create", "read", "update", "delete"],
  },
  {
    name: "repo",
    displayName: "Repository",
    allowedPermissions: ["read", "write", "admin"],
  },
  {
    name: "build",
    displayName: "Build",
    allowedPermissions: ["create", "read", "cancel"],
  },
  {
    name: "gitHostProvider",
    displayName: "Git Host Provider",
    allowedPermissions: ["read", "create", "sync", "admin"],
  },
  {
    name: "customerAccount",
    displayName: "Customer Account",
    allowedPermissions: ["create", "read", "update", "suspend"],
  },
]

export async function bootstrapResourceTypes(
  authClient: FactoryAuthResourceClient
): Promise<void> {
  for (const rt of FACTORY_RESOURCE_TYPES) {
    try {
      await authClient.createResourceType(rt)
    } catch (err) {
      logger.warn({ err, type: rt.name }, "failed to register resource type")
    }
  }
  logger.info(
    { count: FACTORY_RESOURCE_TYPES.length },
    "factory resource types bootstrapped"
  )
}
