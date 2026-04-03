import { select, input } from "@crustjs/prompts";
import {
  INIT_TYPES,
  FRAMEWORKS,
  type InitType,
  type Runtime,
  type Framework,
  getRuntimesForType,
  getFrameworksForTypeAndRuntime,
} from "../../templates/types.js";

export async function promptProjectName(defaultName: string): Promise<string> {
  const raw = await input({
    message: "Project name",
    default: defaultName,
    validate: (v) => {
      if (!v.trim()) return "Project name is required";
      return true;
    },
  });
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

export async function promptInitType(): Promise<InitType> {
  return select<InitType>({
    message: "What would you like to create?",
    choices: INIT_TYPES.map((t) => ({
      value: t.value,
      label: t.label,
      hint: t.description,
    })),
    default: "project",
  });
}

export async function promptRuntime(type: Exclude<InitType, "project">): Promise<Runtime> {
  const runtimes = getRuntimesForType(type);
  if (runtimes.length === 1) return runtimes[0]!;
  return select<Runtime>({
    message: "Runtime",
    choices: runtimes.map((r) => ({
      value: r,
      label: r === "node" ? "Node.js" : r === "java" ? "Java" : "Python",
    })),
  });
}

export async function promptFramework(
  type: Exclude<InitType, "project">,
  runtime: Runtime,
): Promise<Framework> {
  const frameworks = getFrameworksForTypeAndRuntime(type, runtime);
  if (frameworks.length === 1) return frameworks[0]!.value;
  return select<Framework>({
    message: "Framework",
    choices: frameworks.map((f) => ({
      value: f.value,
      label: f.label,
      hint: f.description,
    })),
  });
}

export async function promptOwner(defaultOwner: string): Promise<string> {
  return input({
    message: "Owner/team",
    default: defaultOwner,
    validate: (v) => (v.trim().length > 0 ? true : "Owner is required"),
  });
}
