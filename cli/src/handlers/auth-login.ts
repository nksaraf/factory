import { ExitCodes } from "@smp/factory-shared/exit-codes";
import { input, password as passwordPrompt } from "@crustjs/prompts";

import { createFactoryAuthClient } from "../auth-factory.js";
import { styleError, styleSuccess } from "../cli-style.js";
import { readConfig, resolveFactoryUrl } from "../config.js";
import { ErrorRegistry } from "../errors.js";
import { getStoredBearerToken, SESSION_FILE } from "../session-token.js";
import type { DxFlags } from "../stub.js";

export type AuthLoginArgs = {
  email?: string;
  password?: string;
};

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
  const config = await readConfig();
  let email =
    args.email?.trim() ||
    process.env.DX_AUTH_EMAIL?.trim() ||
    process.env.FACTORY_AUTH_EMAIL?.trim();

  if (!email) {
    email = await input({ message: "Email:" });
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
    password = await passwordPrompt({ message: "Password:" });
  }

  if (!password) {
    exitAuthError(
      flags,
      "Password is required (omit --password to be prompted, or set DX_AUTH_PASSWORD for automation only).",
      "AUTH_DENIED",
      ExitCodes.USAGE_ERROR
    );
  }

  const client = await createFactoryAuthClient(flags);
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
            authUrl: `${resolveFactoryUrl(config)}${config.authBasePath}`,
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
