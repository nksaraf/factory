import { styleBold, styleMuted, styleError, styleWarn, styleSuccess } from "../cli-style.js";
import { getFactoryRestClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import type { DxFlags } from "../stub.js";
import type { LogEntry, LogQueryResult } from "@smp/factory-shared/observability-types";

function formatLevel(level: string): string {
  switch (level) {
    case "error":
    case "fatal":
      return styleError(level.padEnd(5));
    case "warn":
      return styleWarn(level.padEnd(5));
    case "info":
      return styleSuccess(level.padEnd(5));
    case "debug":
      return styleMuted(level.padEnd(5));
    default:
      return level.padEnd(5);
  }
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false, fractionalSecondDigits: 3 });
  } catch {
    return ts;
  }
}

function formatLogLine(entry: LogEntry): string {
  const ts = styleMuted(formatTimestamp(entry.timestamp));
  const level = formatLevel(entry.level);
  const msg = entry.message;

  const attrs: string[] = [];
  if (entry.attributes.op) attrs.push(styleBold(entry.attributes.op));
  if (entry.attributes.runId) attrs.push(styleMuted(entry.attributes.runId));
  if (entry.attributes.durationMs) attrs.push(styleMuted(`${entry.attributes.durationMs}ms`));

  const suffix = attrs.length > 0 ? `  ${attrs.join(" ")}` : "";
  return `${ts}  ${level}  ${msg}${suffix}`;
}

export async function runFactoryLogs(
  flags: DxFlags,
  args?: {
    op?: string;
    run?: string;
    since?: string;
    level?: string;
    grep?: string;
    follow?: boolean;
    limit?: number;
  },
): Promise<void> {
  const rest = await getFactoryRestClient();

  const params = new URLSearchParams();
  if (args?.op) params.set("sandbox", args.op); // sandbox field maps to op filter
  if (args?.level) params.set("level", args.level);
  if (args?.grep) params.set("grep", args.grep);
  if (args?.since) params.set("since", args.since);
  if (args?.limit) params.set("limit", String(args.limit));

  // If filtering by run ID, add as grep filter
  if (args?.run) {
    const existing = params.get("grep");
    params.set("grep", existing ? `${existing}|${args.run}` : args.run);
  }

  const qs = params.toString();
  const basePath = `/api/v1/factory/observability/logs`;
  const path = `${basePath}${qs ? `?${qs}` : ""}`;
  const streamPath = `${basePath}/stream${qs ? `?${qs}` : ""}`;

  try {
    if (args?.follow) {
      await streamLogs(rest, streamPath, flags);
    } else {
      await queryLogs(rest, path, flags, args);
    }
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err));
  }
}

async function queryLogs(
  rest: Awaited<ReturnType<typeof getFactoryRestClient>>,
  path: string,
  flags: DxFlags,
  args?: { since?: string },
): Promise<void> {
  const result = await rest.request<LogQueryResult>("GET", path);

  if (flags.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.entries.length === 0) {
    console.log(styleMuted("No log entries found"));
    if (!args?.since) {
      console.log(styleMuted("  Tip: use --since 1h to search a wider window"));
    }
    return;
  }

  for (const entry of result.entries) {
    console.log(formatLogLine(entry));
  }

  if (result.hasMore) {
    console.log(styleMuted(`\n  ... more entries available (use --limit to increase)`));
  }
}

async function streamLogs(
  rest: Awaited<ReturnType<typeof getFactoryRestClient>>,
  path: string,
  flags: DxFlags,
): Promise<void> {
  const url = rest.url + path;
  const headers: Record<string, string> = {
    Accept: "text/event-stream",
    ...rest.authHeaders(),
  };

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Log stream failed: ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error("No response body for log stream");
  }

  console.log(styleMuted("Streaming logs (Ctrl+C to stop)...\n"));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const cleanup = () => {
    reader.cancel().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const json = line.slice(6);
          try {
            const entry = JSON.parse(json) as LogEntry;
            if (flags.json) {
              console.log(json);
            } else {
              console.log(formatLogLine(entry));
            }
          } catch {
            // skip unparseable SSE data
          }
        }
        // skip comments (": connected") and empty lines
      }
    }
  } finally {
    process.off("SIGINT", cleanup);
    process.off("SIGTERM", cleanup);
  }
}
