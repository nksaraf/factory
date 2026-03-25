import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { styleError, styleInfo, styleSuccess } from "../cli-style.js";
import { getFactoryClient } from "../client.js";
import { readConfig, resolveFactoryUrl } from "../config.js";
import { ErrorRegistry } from "../errors.js";
import { type DxFlags } from "../stub.js";

type HealthBody = { status?: string; service?: string };

function exitApiUnreachable(
  flags: DxFlags,
  apiUrl: string,
  debugInfo?: string
): never {
  const reg = ErrorRegistry.API_UNREACHABLE;
  const message = `${reg.message} at ${apiUrl}`;
  const suggestions = reg.suggestions.map((s) =>
    s.description.includes("$apiUrl")
      ? { ...s, description: s.description.replace("$apiUrl", apiUrl) }
      : s
  );

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: {
            code: "API_UNREACHABLE",
            message,
            details: debugInfo ? { reason: debugInfo } : undefined,
            suggestions,
          },
          exitCode: ExitCodes.CONNECTION_FAILURE,
        },
        null,
        2
      )
    );
    process.exit(ExitCodes.CONNECTION_FAILURE);
  }

  console.error(styleError(message));
  if (flags.debug && debugInfo) {
    console.error(styleError(debugInfo));
  }
  for (const sug of suggestions) {
    console.error(styleError(`  • ${sug.action}: ${sug.description}`));
  }
  process.exit(ExitCodes.CONNECTION_FAILURE);
}

export async function runStatus(flags: DxFlags): Promise<void> {
  const config = await readConfig();
  const displayUrl = resolveFactoryUrl(config);

  try {
    const api = await getFactoryClient();
    const res = await api.health.get();
    const data = res.data as HealthBody | undefined;
    if (data?.status) {
      if (flags.json) {
        console.log(JSON.stringify({ success: true, data }, null, 2));
      } else {
        console.log(
          styleSuccess(
            `Factory API: ${data.status} (${data.service ?? "factory-api"})`
          )
        );
      }
      return;
    }

    const errDetail = res.error
      ? JSON.stringify(res.error)
      : "Health endpoint returned no body or missing status field";
    exitApiUnreachable(flags, displayUrl, errDetail);
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : JSON.stringify(err);
    exitApiUnreachable(flags, displayUrl, detail);
  }
}
