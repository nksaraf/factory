import { select, input } from "@inquirer/prompts";
import type { InstallRole } from "@smp/factory-shared/install-types";
import type { DxConfig } from "../../config.js";

export interface WizardResult {
  role: InstallRole;
  factoryUrl: string;
  siteUrl: string;
  siteName: string;
  domain: string;
  adminEmail: string;
  tlsMode: string;
  tlsCertPath: string;
  tlsKeyPath: string;
  databaseMode: string;
  databaseUrl: string;
  registryMode: string;
  registryUrl: string;
  resourceProfile: string;
}

/**
 * Interactive install wizard. Prompts for essential config,
 * with optional advanced mode for TLS/database/resources.
 */
export async function runWizard(defaults: DxConfig): Promise<WizardResult> {
  const role = await select<InstallRole>({
    message: "Role",
    choices: [
      { value: "workbench", name: "Workbench" },
      { value: "site", name: "Site" },
      { value: "factory", name: "Factory" },
    ],
    default: "workbench",
  });

  if (role === "workbench") {
    const factoryUrl = await input({
      message: "Factory URL",
      default: defaults.factoryUrl || "https://factory.lepton.software",
      validate: (v) => v.length > 0 || "Required",
    });

    return {
      role,
      factoryUrl,
      siteUrl: "",
      siteName: "",
      domain: "",
      adminEmail: "",
      tlsMode: "self-signed",
      tlsCertPath: "",
      tlsKeyPath: "",
      databaseMode: "embedded",
      databaseUrl: "",
      registryMode: "embedded",
      registryUrl: "",
      resourceProfile: "small",
    };
  }

  // Site or Factory
  const siteName = role === "factory"
    ? "factory"
    : await input({
        message: "Site name",
        validate: (v) => /^[a-z0-9][a-z0-9-]*$/.test(v) || "Lowercase alphanumeric with hyphens",
      });

  const domain = await input({
    message: "Domain",
    default: role === "factory" ? "factory.lepton.software" : "",
    validate: (v) => v.length > 0 || "Required",
  });

  const adminEmail = await input({
    message: "Admin email",
    default: defaults.adminEmail || "",
    validate: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || "Valid email required",
  });

  let factoryUrl: string;
  if (role === "factory") {
    factoryUrl = `https://${domain}`;
  } else {
    factoryUrl = await input({
      message: "Factory URL",
      default: defaults.factoryUrl || "https://factory.lepton.software",
      validate: (v) => v.length > 0 || "Required",
    });
  }

  // Advanced options gate
  let tlsMode = "self-signed";
  let tlsCertPath = "";
  let tlsKeyPath = "";
  let databaseMode = "embedded";
  let databaseUrl = "";
  let registryMode = "embedded";
  let registryUrl = "";
  let resourceProfile = role === "factory" ? "medium" : "small";

  const customize = await select({
    message: "Advanced (TLS, database, resources)",
    choices: [
      { value: false, name: "Use defaults" },
      { value: true, name: "Customize" },
    ],
    default: false,
  });

  if (customize) {
    tlsMode = await select({
      message: "TLS",
      choices: [
        { value: "self-signed", name: "Self-signed" },
        { value: "letsencrypt", name: "Let's Encrypt" },
        { value: "provided", name: "Provided (bring your own cert)" },
      ],
      default: "self-signed",
    });

    if (tlsMode === "provided") {
      tlsCertPath = await input({ message: "TLS cert path", validate: (v) => v.length > 0 || "Required" });
      tlsKeyPath = await input({ message: "TLS key path", validate: (v) => v.length > 0 || "Required" });
    }

    databaseMode = await select({
      message: "Database",
      choices: [
        { value: "embedded", name: "Embedded" },
        { value: "external", name: "External" },
      ],
      default: "embedded",
    });

    if (databaseMode === "external") {
      databaseUrl = await input({ message: "Database URL", validate: (v) => v.length > 0 || "Required" });
    }

    resourceProfile = await select({
      message: "Resources",
      choices: [
        { value: "small", name: "Small (dev/testing)" },
        { value: "medium", name: "Medium (production)" },
        { value: "large", name: "Large (high traffic)" },
      ],
      default: resourceProfile,
    });

    registryMode = await select({
      message: "Registry",
      choices: [
        { value: "embedded", name: "Embedded" },
        { value: "external", name: "External" },
      ],
      default: "embedded",
    });

    if (registryMode === "external") {
      registryUrl = await input({ message: "Registry URL" });
    }
  }

  return {
    role,
    factoryUrl,
    siteUrl: `https://${domain}`,
    siteName,
    domain,
    adminEmail,
    tlsMode,
    tlsCertPath,
    tlsKeyPath,
    databaseMode,
    databaseUrl,
    registryMode,
    registryUrl,
    resourceProfile,
  };
}
