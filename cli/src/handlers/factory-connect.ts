import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { styleError, styleInfo, styleSuccess } from "../cli-style.js";
import { dxConfigStore, readConfig, resolveFactoryUrl } from "../config.js";
import { exitWithError } from "../lib/cli-exit.js";
import type { DxFlags } from "../stub.js";

type HealthBody = { status?: string; service?: string };

export async function runFactoryConnect(
  flags: DxFlags,
  args: { url?: string }
): Promise<void> {
  let targetUrl = args.url?.replace(/\/$/, "");

  if (!targetUrl) {
    // Show current connection
    const config = await readConfig();
    const currentUrl = resolveFactoryUrl(config);

    if (flags.json) {
      console.log(
        JSON.stringify(
          { success: true, data: { factoryUrl: currentUrl, role: config.role } },
          null,
          2
        )
      );
      return;
    }
    console.log(`Connected to: ${styleInfo(currentUrl)}`);
    console.log(`Role: ${config.role}`);
    return;
  }

  // Normalize URL
  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
    targetUrl = `https://${targetUrl}`;
  }

  // Verify connectivity
  try {
    const { treaty } = await import("@elysiajs/eden");
    const client = treaty(targetUrl);
    const res = await (client as any).health.get();
    const data = res.data as HealthBody | undefined;

    if (!data?.status) {
      const detail = res.error ? JSON.stringify(res.error) : "No health response";
      exitWithError(flags, `Cannot reach factory at ${targetUrl}: ${detail}`, ExitCodes.CONNECTION_FAILURE);
    }

    // Save to config
    await dxConfigStore.update((prev) => ({ ...prev, factoryUrl: targetUrl! }));

    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: true,
            data: {
              factoryUrl: targetUrl,
              api: { status: data.status, service: data.service },
            },
          },
          null,
          2
        )
      );
      return;
    }

    console.log(styleSuccess(`Connected to ${targetUrl}`));
    console.log(`API: ${data.status} (${data.service ?? "factory-api"})`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    exitWithError(
      flags,
      `Cannot reach factory at ${targetUrl}: ${detail}`,
      ExitCodes.CONNECTION_FAILURE
    );
  }
}
