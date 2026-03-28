import { createApp } from "vinxi";

export default createApp({
  routers: [
    {
      type: "static",
      name: "public",
      dir: "./public",
    },
    {
      type: "spa",
      name: "client",
      handler: "./src/entry.client.tsx",
      target: "browser",
      routes: (router: any, app: any) =>
        new (require("vinxi/fs-router"))({
          dir: "./src/routes",
          extensions: ["page.tsx"],
        }),
    },
    {
      type: "http",
      name: "server",
      handler: "./src/entry.server.tsx",
      target: "server",
    },
  ],
});
