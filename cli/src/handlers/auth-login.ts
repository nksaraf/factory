import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { createFactoryAuthClient } from "../auth-factory.js";
import { styleError, styleSuccess } from "../cli-style.js";
import { loadConfig } from "../config.js";
import { ErrorRegistry } from "../errors.js";
import { getStoredBearerToken, SESSION_FILE } from "../session-token.js";
import type { DxFlags } from "../stub.js";

export type AuthLoginArgs = {
  email?: string;
  password?: string;
};

async function promptLine(question: string): Promise<string> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Hidden password on Node when stdin is a TTY (raw mode). */
function promptPasswordNodeHidden(): Promise<string> {
  const stdin = process.stdin;
  const stdout = process.stdout;

  return new Promise((resolve) => {
    let rawEnabled = false;
    try {
      stdin.setRawMode(true);
      rawEnabled = true;
    } catch {
      void promptLine("Password: ").then(resolve);
      return;
    }

    stdout.write("Password: ");
    stdin.resume();
    stdin.setEncoding("utf8");

    let password = "";

    const cleanup = () => {
      if (rawEnabled) {
        try {
          stdin.setRawMode(false);
        } catch {
          /* ignore */
        }
        rawEnabled = false;
      }
      stdin.removeListener("data", onData);
      try {
        if (stdin.isTTY) stdin.pause();
      } catch {
        /* ignore */
      }
    };

    const onData = (chunk: string | Buffer) => {
      const s =
        typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      if (s.length > 0 && s.charCodeAt(0) === 0x1b) {
        return;
      }
      for (const char of s) {
        const code = char.charCodeAt(0);
        if (code === 13 || code === 10) {
          cleanup();
          stdout.write("\n");
          resolve(password);
          return;
        }
        if (code === 3) {
          cleanup();
          stdout.write("\n");
          process.exit(130);
        }
        if (code === 4) {
          cleanup();
          stdout.write("\n");
          resolve(password);
          return;
        }
        if (code === 127 || code === 8) {
          password = password.slice(0, -1);
          continue;
        }
        password += char;
      }
    };

    stdin.on("data", onData);
  });
}

async function promptPasswordHidden(): Promise<string> {
  const g = globalThis as unknown as {
    Bun?: { password?: (opts: { prompt: string }) => Promise<string> };
  };
  if (typeof g.Bun?.password === "function") {
    return g.Bun.password({ prompt: "Password: " });
  }
  if (process.stdin.isTTY) {
    return promptPasswordNodeHidden();
  }
  return promptLine("Password: ");
}

function exitAuthError(
  flags: DxFlags,
  message: string,
  code: keyof typeof ErrorRegistry,
  exitCode: number,
  detail?: string
): never {
  const reg = ErrorRegistry[code];
  const suggestions = reg?.suggestions ?? [];

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: {
            code,
            message,
            details: detail ? { reason: detail } : undefined,
            suggestions,
          },
          exitCode,
        },
        null,
        2
      )
    );
    process.exit(exitCode);
  }

  console.error(styleError(message));
  if (flags.debug && detail) {
    console.error(styleError(detail));
  }
  for (const sug of suggestions) {
    console.error(styleError(`  • ${sug.action}: ${sug.description}`));
  }
  process.exit(exitCode);
}

export async function runAuthLogin(
  flags: DxFlags,
  args: AuthLoginArgs
): Promise<void> {
  const cfg = loadConfig();
  let email =
    args.email?.trim() ||
    process.env.DX_AUTH_EMAIL?.trim() ||
    process.env.FACTORY_AUTH_EMAIL?.trim();

  if (!email) {
    email = await promptLine("Email: ");
  }

  if (!email) {
    exitAuthError(
      flags,
      "Email is required (flag --email, env DX_AUTH_EMAIL, or prompt).",
      "AUTH_DENIED",
      ExitCodes.USAGE_ERROR
    );
  }

  let password =
    args.password ??
    process.env.DX_AUTH_PASSWORD ??
    process.env.FACTORY_AUTH_PASSWORD;

  if (!password) {
    password = await promptPasswordHidden();
  }

  if (!password) {
    exitAuthError(
      flags,
      "Password is required (omit --password to be prompted, or set DX_AUTH_PASSWORD for automation only).",
      "AUTH_DENIED",
      ExitCodes.USAGE_ERROR
    );
  }

  const client = createFactoryAuthClient(flags);
  let result: Awaited<ReturnType<typeof client.signIn.email>>;
  try {
    result = await client.signIn.email({
      email,
      password,
      rememberMe: true,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    exitAuthError(
      flags,
      "Could not reach the auth service.",
      "API_UNREACHABLE",
      ExitCodes.CONNECTION_FAILURE,
      reason
    );
  }

  if (result.error) {
    const msg =
      (result.error as { message?: string }).message ??
      String(result.error ?? "Sign-in failed");
    exitAuthError(
      flags,
      "Sign-in failed.",
      "AUTH_DENIED",
      ExitCodes.AUTH_FAILURE,
      msg
    );
  }

  const bearer = await getStoredBearerToken();
  if (!bearer) {
    exitAuthError(
      flags,
      "Sign-in succeeded but no bearer token was returned. Check auth service bearer plugin and CORS.",
      "AUTH_DENIED",
      ExitCodes.AUTH_FAILURE
    );
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          data: {
            user: result.data?.user ?? null,
            sessionPath: SESSION_FILE,
            authUrl: `${cfg.authUrl.replace(/\/$/, "")}${cfg.authBasePath}`,
          },
          exitCode: ExitCodes.SUCCESS,
        },
        null,
        2
      )
    );
    return;
  }

  const u = result.data?.user;
  console.log(
    styleSuccess(
      `Signed in as ${u?.email ?? email}` +
        (u?.name ? ` (${u.name})` : "") +
        `. Session saved to ${SESSION_FILE} (mode 0600).`
    )
  );
}
