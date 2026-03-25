import { ExitCodes } from "@smp/factory-shared/exit-codes";

import { createFactoryAuthClient } from "../auth-factory.js";
import { styleError, styleInfo, styleSuccess } from "../cli-style.js";
import { readConfig, resolveFactoryUrl } from "../config.js";
import { ErrorRegistry } from "../errors.js";
import { getStoredBearerToken } from "../session-token.js";
import type { DxFlags } from "../stub.js";

export async function runWhoami(flags: DxFlags): Promise<void> {
  const config = await readConfig();
  const token = await getStoredBearerToken();

  if (!token) {
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: false,
            error: {
              code: "AUTH_DENIED",
              message: "Not signed in. Run `dx auth login`.",
            },
            exitCode: ExitCodes.AUTH_FAILURE,
          },
          null,
          2
        )
      );
      process.exit(ExitCodes.AUTH_FAILURE);
    }
    console.error(styleError("Not signed in. Run `dx auth login`."));
    process.exit(ExitCodes.AUTH_FAILURE);
  }

  const client = await createFactoryAuthClient(flags);
  let sessionRes: Awaited<ReturnType<typeof client.getSession>>;
  try {
    sessionRes = await client.getSession();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const reg = ErrorRegistry.API_UNREACHABLE;
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: false,
            error: {
              code: "API_UNREACHABLE",
              message: `${reg.message} (auth service)`,
              details: { reason },
              suggestions: reg.suggestions,
            },
            exitCode: ExitCodes.CONNECTION_FAILURE,
          },
          null,
          2
        )
      );
    } else {
      console.error(styleError(`${reg.message} (auth service)`));
      if (flags.debug) {
        console.error(styleError(reason));
      }
    }
    process.exit(ExitCodes.CONNECTION_FAILURE);
  }

  const { data, error } = sessionRes;

  if (error || !data?.user) {
    const detail =
      (error as { message?: string } | undefined)?.message ??
      (error ? String(error) : "No session");
    if (flags.json) {
      console.log(
        JSON.stringify(
          {
            success: false,
            error: {
              code: "AUTH_DENIED",
              message: "Session invalid or expired. Run `dx auth login`.",
              details: { reason: detail },
            },
            exitCode: ExitCodes.AUTH_FAILURE,
          },
          null,
          2
        )
      );
    } else {
      console.error(
        styleError("Session invalid or expired. Run `dx auth login`.")
      );
      if (flags.debug) {
        console.error(styleError(detail));
      }
    }
    process.exit(ExitCodes.AUTH_FAILURE);
  }

  const user = data.user;
  const session = data.session;

  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          success: true,
          data: {
            user: {
              id: user.id,
              email: user.email,
              name: user.name,
              image: user.image,
            },
            session: session
              ? { id: session.id, expiresAt: session.expiresAt }
              : null,
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

  console.log(
    styleSuccess(`${user.email}${user.name ? ` — ${user.name}` : ""}`)
  );
  console.log(styleInfo(`user id: ${user.id}`));
  if (session?.expiresAt) {
    console.log(styleInfo(`session expires: ${session.expiresAt}`));
  }
}
