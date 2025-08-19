import { fromHono } from "chanfana";
import { Hono } from "hono";
import { Transcribe } from "./endpoints/transcribe";
import { Ping } from "./endpoints/ping";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Setup OpenAPI registry and mount endpoints
const openapi = fromHono(app, { docs_url: "/" });
openapi.get("/ping", Ping);
openapi.post("/transcribe", Transcribe);

// Export the Hono app
export default app;
