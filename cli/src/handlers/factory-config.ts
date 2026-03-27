import { styleBold, styleInfo, styleMuted } from "../cli-style.js";
import { readConfig, configPath, resolveFactoryUrl, resolveSiteUrl } from "../config.js";
import type { DxFlags } from "../stub.js";

export async function runFactoryConfig(flags: DxFlags): Promise<void> {
  const config = await readConfig();
  const file = configPath();

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          data: {
            configPath: file,
            factoryUrl: resolveFactoryUrl(config),
            siteUrl: resolveSiteUrl(config) || undefined,
            role: config.role,
            siteName: config.siteName || undefined,
            domain: config.domain || undefined,
            adminEmail: config.adminEmail || undefined,
            tlsMode: config.tlsMode,
            databaseMode: config.databaseMode,
            registryMode: config.registryMode,
            resourceProfile: config.resourceProfile,
            installMode: config.installMode,
            kubeconfig: config.kubeconfig || undefined,
          },
        },
        null,
        2
      )
    );
    return;
  }

  console.log(styleBold("Factory Configuration"));
  console.log(styleMuted(file));
  console.log("");
  console.log(`${styleBold("Factory URL:")}  ${styleInfo(resolveFactoryUrl(config))}`);
  const siteUrl = resolveSiteUrl(config);
  if (siteUrl) {
    console.log(`${styleBold("Site URL:")}     ${styleInfo(siteUrl)}`);
  }
  console.log(`${styleBold("Role:")}         ${config.role}`);
  if (config.siteName) {
    console.log(`${styleBold("Site Name:")}    ${config.siteName}`);
  }
  if (config.domain) {
    console.log(`${styleBold("Domain:")}       ${config.domain}`);
  }
  if (config.adminEmail) {
    console.log(`${styleBold("Admin:")}        ${config.adminEmail}`);
  }
  console.log("");
  console.log(`${styleBold("TLS:")}          ${config.tlsMode}`);
  console.log(`${styleBold("Database:")}     ${config.databaseMode}`);
  console.log(`${styleBold("Registry:")}     ${config.registryMode}`);
  console.log(`${styleBold("Resources:")}    ${config.resourceProfile}`);
  console.log(`${styleBold("Install Mode:")} ${config.installMode}`);
  if (config.kubeconfig) {
    console.log(`${styleBold("Kubeconfig:")}   ${config.kubeconfig}`);
  }
}
