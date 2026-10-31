import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { hashPassword } from "../domain/auth";
import { users, sessions, items as itemsTable, categories, units } from "../db/schema";
import { eq, like, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import importApp from "./import-service";
import docApp from "./documents-service";
import reportsApp from "./reports-service";

type Bindings = {
  DB: D1Database;
  ADMIN_EMAIL: string;
  APP_SECRET: string;
};

type Variables = {
  session: { userId: number; email: string; role: string } | null;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── session middleware ─────────────────────────────────────────────────────────
app.use("/api/*", async (c, next) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    const db = drizzle(c.env.DB);
    const row = await c.env.DB.prepare(
      `SELECT s.id, s.expires_at, u.id as user_id, u.email, u.role, u.is_active
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=?`,
    ).bind(sessionId).first() as any;
    if (row && new Date(row.expires_at).getTime() > Date.now() && row.is_active) {
      c.set("session", { userId: row.user_id, email: row.email, role: row.role });
    } else {
      c.set("session", null);
    }
  } else {
    c.set("session", null);
  }
  await next();
});

// ── health ────────────────────────────────────────────────────────────────────
app.get("/api/health", (c) => c.json({ ok: true }));

// ── first-run check ───────────────────────────────────────────────────────────
app.get("/api/setup/status", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM users").first() as any;
  return c.json({ needsSetup: row.cnt === 0 });
});

app.post("/api/setup/init", async (c) => {
  const row = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM users").first() as any;
  if (row.cnt > 0) return c.json({ error: "already_initialized" }, 409);

  const schema = z.object({ password: z.string().min(8) });
  const body = await c.req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  const hash = await hashPassword(parsed.data.password);
  await c.env.DB.prepare(
    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'OWNER')",
  ).bind(c.env.ADMIN_EMAIL, hash).run();

  return c.json({ ok: true });
});

// ── auth ──────────────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input" }, 400);

  const { email, password } = parsed.data;
  const user = await c.env.DB.prepare(
    "SELECT id, email, password_hash, role, is_active, failed_logins, locked_until FROM users WHERE email=?",
  ).bind(email).first() as any;

  if (!user || !user.is_active) return c.json({ error: "invalid_credentials" }, 401);

  const { checkLockout, verifyPassword, generateSessionId } = await import("../domain/auth");
  if (checkLockout(user.failed_logins, user.locked_until)) {
    return c.json({ error: "account_locked" }, 403);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const newFails = user.failed_logins + 1;
    if (newFails >= 10) {
      const lockedUntil = new Date(Date.now() + 15 * 60_000).toISOString();
      await c.env.DB.prepare("UPDATE users SET failed_logins=?, locked_until=? WHERE id=?")
        .bind(newFails, lockedUntil, user.id).run();
      return c.json({ error: "account_locked" }, 403);
    }
    await c.env.DB.prepare("UPDATE users SET failed_logins=? WHERE id=?").bind(newFails, user.id).run();
    return c.json({ error: "invalid_credentials" }, 401);
  }

  await c.env.DB.prepare("UPDATE users SET failed_logins=0, locked_until=NULL WHERE id=?").bind(user.id).run();

  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + 8 * 3_600_000).toISOString();
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?,?,?)")
    .bind(sessionId, user.id, expiresAt).run();

  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  });

  return c.json({ ok: true, role: user.role });
});

app.post("/api/auth/logout", async (c) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id=?").bind(sessionId).run();
  }
  deleteCookie(c, "session", { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/auth/me", (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  return c.json({ email: session.email, role: session.role });
});

// ── items ─────────────────────────────────────────────────────────────────────
const itemSchema = z.object({
  sku: z.string().min(1).max(100),
  name_th: z.string().min(1).max(200),
  barcode: z.string().max(50).optional(),
  category_id: z.number().int().positive().optional(),
  unit_id: z.number().int().positive(),
  track_lot: z.boolean().optional().default(false),
  reorder_point_milli: z.number().int().min(0).optional().default(0),
  standard_cost_x4: z.number().int().min(0).optional().default(0),
});

function applyRoleFilter(item: any, role: string) {
  if (role !== "OWNER") {
    const { standard_cost_x4, ...rest } = item;
    return rest;
  }
  return item;
}

// ── warehouses (list for dropdowns) ──────────────────────────────────────────
app.get("/api/warehouses", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const rows = await c.env.DB.prepare("SELECT id, code, name FROM warehouses WHERE is_active=1 ORDER BY code").all();
  return c.json({ warehouses: rows.results });
});

// ── lots upsert (สำหรับ Receive) ─────────────────────────────────────────────
app.post("/api/lots", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_json" }, 400);
  const { item_id, lot_no, mfg_date, expiry_date, po_no, manufacturer_name } = body;
  if (!item_id || !lot_no || !mfg_date || !expiry_date) return c.json({ error: "missing_fields" }, 400);
  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO lots (item_id, lot_no, mfg_date, expiry_date, po_no, manufacturer_name, created_at)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(item_id, lot_no) DO NOTHING`,
  ).bind(item_id, lot_no, mfg_date, expiry_date, po_no ?? null, manufacturer_name ?? null, nowIso).run();
  const row = await c.env.DB.prepare("SELECT id FROM lots WHERE item_id=? AND lot_no=?").bind(item_id, lot_no).first() as { id: number };
  return c.json({ ok: true, lot_id: row.id });
});

app.get("/api/items", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const q = c.req.query("q") ?? "";
  let rows: any[];
  if (q && /^\d{8,}$/.test(q.trim())) {
    rows = await c.env.DB.prepare("SELECT * FROM items WHERE barcode=? AND status='ACTIVE'").bind(q.trim()).all().then(r => r.results);
  } else if (q) {
    rows = await c.env.DB.prepare("SELECT * FROM items WHERE name_th LIKE ? AND status='ACTIVE'").bind(`%${q}%`).all().then(r => r.results);
  } else {
    rows = await c.env.DB.prepare("SELECT * FROM items WHERE status='ACTIVE'").all().then(r => r.results);
  }

  return c.json(rows.map((item) => applyRoleFilter(item, session.role)));
});

app.post("/api/items", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);

  const body = await c.req.json().catch(() => ({}));
  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  const d = parsed.data;
  const result = await c.env.DB.prepare(
    `INSERT INTO items (sku, name_th, barcode, category_id, unit_id, track_lot, reorder_point_milli, standard_cost_x4)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(d.sku, d.name_th, d.barcode ?? null, d.category_id ?? null, d.unit_id, d.track_lot ? 1 : 0, d.reorder_point_milli, d.standard_cost_x4).run();

  const id = result.meta.last_row_id;
  await c.env.DB.prepare(
    "INSERT INTO audit_logs (table_name, record_id, action, old_json, new_json, user_id, at) VALUES ('items',?,'INSERT',NULL,?,?,?)",
  ).bind(String(id), JSON.stringify(d), session.userId, new Date().toISOString()).run();

  return c.json({ ok: true, id });
});

app.put("/api/items/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);

  const id = Number(c.req.param("id"));
  const old = await c.env.DB.prepare("SELECT * FROM items WHERE id=?").bind(id).first();
  if (!old) return c.json({ error: "not_found" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const parsed = itemSchema.partial().safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  const merged = { ...old, ...parsed.data } as any;
  await c.env.DB.prepare(
    `UPDATE items SET sku=?, name_th=?, barcode=?, category_id=?, unit_id=?, track_lot=?, reorder_point_milli=?, standard_cost_x4=? WHERE id=?`,
  ).bind(merged.sku, merged.name_th, merged.barcode ?? null, merged.category_id ?? null, merged.unit_id, merged.track_lot ? 1 : 0, merged.reorder_point_milli, merged.standard_cost_x4, id).run();

  await c.env.DB.prepare(
    "INSERT INTO audit_logs (table_name, record_id, action, old_json, new_json, user_id, at) VALUES ('items',?,'UPDATE',?,?,?,?)",
  ).bind(String(id), JSON.stringify(old), JSON.stringify(merged), session.userId, new Date().toISOString()).run();

  return c.json({ ok: true });
});

// ── import ────────────────────────────────────────────────────────────────────
app.route("/", importApp);

// ── documents ─────────────────────────────────────────────────────────────────
app.route("/", docApp);
app.route("/api/reports", reportsApp);

// ── frontend fallback ─────────────────────────────────────────────────────────
app.get("*", async (c) => {
  try {
    const { serveStatic } = await import("hono/cloudflare-workers");
    return serveStatic({ root: "./" })(c, async () => {});
  } catch {
    return c.html("<!doctype html><html><body><div id='root'></div><script type='module' src='/src/web/main.tsx'></script></body></html>");
  }
});

export default app;
