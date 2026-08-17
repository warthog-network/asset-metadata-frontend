// Bun.serve entrypoint. Three layers of error containment:
//
//   1. Per-call try/catch in `lib/{node,github,images}.ts` — known errors
//      become typed errors, all external calls log on failure.
//   2. Per-handler try/catch in `handlers/*.ts` — submission never throws
//      (always returns a Result), but handlers defensively translate.
//   3. `safeHandle` here — wraps the fetch handler. ANY uncaught exception
//      becomes a logged 500. The service keeps running no matter what
//      a single request does.
//
// Plus `maxRequestBodySize: 2 MB` so oversize uploads are rejected
// before they hit any handler.

import { handleHome } from "./handlers/home";
import { handleSubmit } from "./handlers/submit";
import { handleNodeHealth } from "./handlers/node-health";
import { env } from "./env";

const PORT = env.port;

// Wrap a handler so any uncaught exception becomes a logged 500 instead
// of crashing the process. Each handler already has its own try/catch,
// but this is the last line of defense.
function safeHandle(name: string, handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const start = Date.now();
    try {
      const res = await handler(req);
      const ms = Date.now() - start;
      console.log(`${req.method} ${url.pathname} → ${res.status} (${ms}ms)`);
      return res;
    } catch (err) {
      const ms = Date.now() - start;
      console.error(
        `[${new Date().toISOString()}] UNHANDLED in ${name} ${req.method} ${url.pathname} (${ms}ms):`,
        err,
      );
      return Response.json(
        { ok: false, error: "internal server error" },
        { status: 500 },
      );
    }
  };
}

const server = Bun.serve({
  port: PORT,
  // 2 MB max body — generous for a 250x250 PNG (~5-30 KB) and a 600x200
  // banner (~10-50 KB), with ~50x safety margin. Anything bigger is
  // rejected with 413 by Bun automatically.
  maxRequestBodySize: 2 * 1024 * 1024,

  fetch(req) {
    const url = new URL(req.url);

    // Static assets served directly from public/. Bun.file() streams,
    // so no try/catch needed.
    if (url.pathname === "/images/warthog-mark.svg") {
      return new Response(Bun.file("./public/images/warthog-mark.svg"));
    }
    if (url.pathname === "/css/app.css") {
      return new Response(Bun.file("./public/assets/app.css"), {
        headers: { "Content-Type": "text/css; charset=utf-8" },
      });
    }
    if (url.pathname === "/js/app.js") {
      return new Response(Bun.file("./public/assets/app.js"), {
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      });
    }

    switch (true) {
      case url.pathname === "/" && req.method === "GET":
        return safeHandle("home", handleHome)(req);
      case url.pathname === "/api/submit" && req.method === "POST":
        return safeHandle("submit", handleSubmit)(req);
      case url.pathname === "/api/node-health" && req.method === "GET":
        return safeHandle("node-health", handleNodeHealth)(req);
      default:
        return new Response("Not found", { status: 404 });
    }
  },
});

console.log(`Warthog Asset Metadata service on http://localhost:${server.port}`);
