import { existsSync } from "node:fs";
import { join } from "node:path";

export type ServiceType = "node" | "python" | "java";

/**
 * Auto-detect the service type of a component by checking for
 * well-known marker files in its directory.
 */
export function detectServiceType(dir: string): ServiceType | null {
  if (existsSync(join(dir, "package.json"))) return "node";
  if (
    existsSync(join(dir, "pyproject.toml")) ||
    existsSync(join(dir, "setup.py"))
  )
    return "python";
  if (
    existsSync(join(dir, "pom.xml")) ||
    existsSync(join(dir, "build.gradle"))
  )
    return "java";
  return null;
}
