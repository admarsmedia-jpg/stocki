import { Hono } from "hono";
import { serveStatic } from "hono/cloudflare-workers";

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_EMAIL: string;
  APP_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ ok: true }));

// Serve frontend static assets for all non-API routes
app.get("*", serveStatic({ root: "./" }));

export default app;
