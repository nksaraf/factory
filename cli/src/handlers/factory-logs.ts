import { styleBold, styleMuted, styleError, styleWarn, styleSuccess } from "../cli-style.js";
import { getFactoryRestClient } from "../client.js";
import { exitWithError } from "../lib/cli-exit.js";
import type { DxFlags } from "../stub.js";

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  source: string;
  attributes: Record<string, string>;
  traceId?: string;
  spanId?: string;
}

interface LogQueryResult {
  entries: LogEntry[];
  hasMore: boolean;
  cursor?: string;
}

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
  if (args?.follow) params.set("follow", "true");

  // If filtering by run ID, add as grep filter
  if (args?.run) {
    const existing = params.get("grep");
    params.set("grep", existing ? `${existing}|${args.run}` : args.run);
  }

  const qs = params.toString();
  const path = `/api/v1/factory/observability/logs${qs ? `?${qs}` : ""}`;

  try {
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
  } catch (err) {
    exitWithError(flags, err instanceof Error ? err.message : String(err));
  }
}
