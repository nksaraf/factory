import type { DxBase } from "../dx-root.js";
import {
  runConfigGet,
  runConfigPath,
  runConfigReset,
  runConfigSet,
  runConfigShow,
} from "../handlers/config.js";

import { toDxFlags } from "./dx-flags.js";

export function configCommand(app: DxBase) {
  return app
    .sub("config")
    .meta({ description: "View and manage DX configuration" })
    .run(async ({ flags }) => {
      await runConfigShow(toDxFlags(flags));
    })
    .command("show", (c) =>
      c
        .meta({ description: "Display the merged configuration" })
        .run(async ({ flags }) => {
          await runConfigShow(toDxFlags(flags));
        })
    )
    .command("get", (c) =>
      c
        .meta({ description: "Get a single config value" })
        .args([
          {
            name: "key",
            type: "string",
            required: true,
            description: "Config key to read",
          },
        ])
        .run(async ({ flags, args }) => {
          await runConfigGet(toDxFlags(flags), args.key as string);
        })
    )
    .command("set", (c) =>
      c
        .meta({ description: "Set a config value (global)" })
        .args([
          {
            name: "key",
            type: "string",
            required: true,
            description: "Config key to set",
          },
          {
            name: "value",
            type: "string",
            required: true,
            description: "Value to assign",
          },
        ])
        .run(async ({ flags, args }) => {
          await runConfigSet(
            toDxFlags(flags),
            args.key as string,
            args.value as string
          );
        })
    )
    .command("path", (c) =>
      c
        .meta({ description: "Print the config file path" })
        .run(async ({ flags }) => {
          await runConfigPath(toDxFlags(flags));
        })
    )
    .command("reset", (c) =>
      c
        .meta({ description: "Reset a config key to its default value" })
        .args([
          {
            name: "key",
            type: "string",
            required: true,
            description: "Config key to reset",
          },
        ])
        .run(async ({ flags, args }) => {
          await runConfigReset(toDxFlags(flags), args.key as string);
        })
    );
}
