import type { DxBase } from "../dx-root.js";
import { runAuthLogin } from "../handlers/auth-login.js";
import { runAuthLogout } from "../handlers/auth-logout.js";

import { toDxFlags } from "./dx-flags.js";
import { stubRun } from "./stub-run.js";

export function authCommand(app: DxBase) {
  return app
    .sub("auth")
    .meta({ description: "Sign in and session management" })
    .command("login", (c) =>
      c
        .meta({ description: "Sign in with email and password" })
        .flags({
          email: {
            type: "string",
            short: "e",
            description: "Account email",
          },
          password: {
            type: "string",
            description:
              "Password (visible in shell history; omit for a hidden TTY prompt)",
          },
        })
        .run(async ({ flags }) => {
          const f = toDxFlags(flags);
          await runAuthLogin(f, {
            email: f.email as string | undefined,
            password: f.password as string | undefined,
          });
        })
    )
    .command("logout", (c) =>
      c.meta({ description: "Sign out and remove local session" }).run(
        async ({ flags }) => {
          await runAuthLogout(toDxFlags(flags));
        }
      )
    )
    .command("status", (c) =>
      c.meta({ description: "Auth configuration status" }).run(stubRun)
    );
}
