import { select, input } from "@crustjs/prompts";
import { STANDALONE_TYPES, type InitMode, type StandaloneType } from "../../templates/types.js";

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

export async function promptInitMode(): Promise<InitMode> {
  return select<InitMode>({
    message: "What would you like to create?",
    choices: [
      { value: "project", label: "Project", hint: "Full monorepo with apps, services, packages, and infrastructure" },
      { value: "standalone", label: "Standalone", hint: "Single service, app, or library in its own repo" },
    ],
    default: "project",
  });
}

export async function promptStandaloneType(): Promise<StandaloneType> {
  return select<StandaloneType>({
    message: "Standalone type",
    choices: STANDALONE_TYPES.map((t) => ({
      value: t.value,
      label: t.label,
      hint: t.description,
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
