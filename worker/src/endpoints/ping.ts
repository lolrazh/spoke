import { OpenAPIRoute } from "chanfana";
import type { Context } from "hono";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, X-Mode",
  "Access-Control-Expose-Headers": "Server-Timing, CF-Worker-Colo, X-Request-Id",
  "Cache-Control": "no-store",
};

export class Ping extends OpenAPIRoute {
  schema = {
    tags: ["Health"],
    summary: "Health check",
    responses: {
      "204": { description: "OK" },
    },
  };

  async handle(c: Context) {
    const headers = new Headers(CORS);
    headers.set("CF-Worker-Colo", (c.req.raw as any)?.cf?.colo ?? "unknown");
    headers.set("X-Request-Id", (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
    return new Response(null, { status: 204, headers });
  }
}

