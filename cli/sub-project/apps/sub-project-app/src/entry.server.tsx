import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { defineEventHandler, getRequestURL } from "vinxi/http";
import Home from "./routes/index/page";

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);

  const html = renderToString(
    <StaticRouter location={url.pathname}>
      <Home />
    </StaticRouter>,
  );

  return new Response(
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>sub-project</title>
    <link rel="stylesheet" href="/src/globals.css" />
  </head>
  <body>
    <div id="root">${html}</div>
    <script type="module" src="/src/entry.client.tsx"></script>
  </body>
</html>`,
    { headers: { "Content-Type": "text/html" } },
  );
});
