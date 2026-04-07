import { select, input } from "@crustjs/prompts";
import { RESOURCE_CATALOG, type ResourceName } from "../../templates/resource/index.js";
import {
  type InitType,
  type Runtime,
  type Framework,
  getRuntimesForType,
  getFrameworksForTypeAndRuntime,
} from "../../templates/types.js";

export type AddCategory = "resource" | "component";

export async function promptAddCategory(): Promise<AddCategory> {
  return select<AddCategory>({
    message: "What would you like to add?",
    choices: [
      { value: "resource", label: "Resource", hint: "Infrastructure like PostgreSQL, Redis, Kafka" },
      { value: "component", label: "Component", hint: "Service, website, or library" },
    ],
  });
}

export async function promptResourceName(): Promise<ResourceName> {
  return select<ResourceName>({
    message: "Which resource?",
    choices: RESOURCE_CATALOG.map((r) => ({
      value: r.name,
      label: r.label,
      hint: r.description,
    })),
  });
}

const ADD_COMPONENT_TYPES: { value: Exclude<InitType, "project">; label: string; hint: string }[] = [
  { value: "service", label: "Service", hint: "Backend API service" },
  { value: "website", label: "Website", hint: "Frontend web application" },
  { value: "library", label: "Library", hint: "Shared library/package" },
];

export async function promptComponentType(): Promise<Exclude<InitType, "project">> {
  return select<Exclude<InitType, "project">>({
    message: "Component type",
    choices: ADD_COMPONENT_TYPES,
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

export async function promptComponentName(): Promise<string> {
  const raw = await input({
    message: "Component name",
    validate: (v) => {
      if (!v.trim()) return "Name is required";
      return true;
    },
  });
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
