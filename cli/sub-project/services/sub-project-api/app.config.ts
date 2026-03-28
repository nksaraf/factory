import { createApp } from "vinxi";

export default createApp({
  routers: [
    {
      type: "http",
      handler: "./src/handler.ts",
      target: "server",
      name: "server",
    },
  ],
});
