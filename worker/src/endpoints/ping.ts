import { OpenAPIRoute } from "chanfana";
import type { Context } from "hono";

export class Ping extends OpenAPIRoute {
  schema = {
    tags: ["Health"],
    summary: "Health check",
    responses: {
      "204": { description: "OK" },
    },
  };

  async handle(c: Context) {
    // CORS and common headers are applied by global middleware (see index.ts)
    return c.body(null, 204);
  }
}
