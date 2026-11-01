import { Hono } from "hono";
import { z } from "zod";
import { computePostDocumentUpdates, type BalanceSnapshot } from "../domain/postDocument";
import { validateIssueLines, buildIdempotencyResponse, buildDocNo, computeFEFOOrder, type LotInfo } from "../domain/documentEngine";

type Bindings = { DB: D1Database; ADMIN_EMAIL: string; APP_SECRET: string };
type Variables = { session: { userId: number; email: string; role: string } | null };

const docApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// ── schemas ───────────────────────────────────────────────────────────────────

const lineSchema = z.object({
  item_id: z.number().int().positive(),
  lot_id: z.number().int().min(0).default(0),
  qty_milli: z.number().int().positive(),
  unit_cost_x4: z.number().int().min(0).default(0),
});

const receiveLineSchema = z.object({
  item_id: z.number().int().positive(),
  qty_milli: z.number().int().positive(),
  unit_cost_x4: z.number().int().min(0).default(0),
  // ล็อต — ถ้ามีจะสร้างใน transaction เดียวกัน
  lot_no: z.string().max(100).optional(),
  lot_mfg_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lot_expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lot_po_no: z.string().max(100).optional(),
  lot_manufacturer_name: z.string().max(200).optional(),
});

const receiveSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  warehouse_id: z.number().int().positive(),
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ref_text: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
  lines: z.array(receiveLineSchema).min(1).max(200),
});

const issueSchema = z.object({
  idempotency_key: z.string().min(1).max(128),
  warehouse_id: z.number().int().positive(),
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ref_text: z.string().max(200).optional(),
  note: z.string().max(500).optional(),
  lines: z.array(lineSchema).min(1).max(200),
});

// ── helpers ───────────────────────────────────────────────────────────────────

async function nextDocNo(db: D1Database, docType: "RECEIVE" | "ISSUE", yymm: string): Promise<string> {
  await db.prepare(
    `INSERT INTO doc_sequences (doc_type, yymm, last_no) VALUES (?,?,1)
     ON CONFLICT(doc_type, yymm) DO UPDATE SET last_no = last_no + 1`,
  ).bind(docType, yymm).run();
  const row = await db.prepare(
    "SELECT last_no FROM doc_sequences WHERE doc_type=? AND yymm=?",
  ).bind(docType, yymm).first() as { last_no: number };
  return buildDocNo(docType, yymm, row.last_no);
}

async function loadBalanceSnapshot(
  db: D1Database,
  warehouse_id: number,
  lines: Array<{ item_id: number; lot_id: number | null }>,
): Promise<BalanceSnapshot> {
  const snap: BalanceSnapshot = new Map();
  for (const line of lines) {
    const lotId = line.lot_id ?? 0;
    const row = await db.prepare(
      `SELECT qty_on_hand_milli, avg_cost_x4 FROM stock_balances
       WHERE item_id=? AND lot_id=? AND warehouse_id=?`,
    ).bind(line.item_id, lotId, warehouse_id).first() as { qty_on_hand_milli: number; avg_cost_x4: number } | null;
    const key = `${line.item_id}:${lotId}:${warehouse_id}`;
    snap.set(key, { qty: row?.qty_on_hand_milli ?? 0, avg_cost: row?.avg_cost_x4 ?? 0 });
  }
  return snap;
}

// ── POST /api/documents/receive ───────────────────────────────────────────────

docApp.post("/api/documents/receive", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_json" }, 400);

  const parsed = receiveSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  const { idempotency_key, warehouse_id, doc_date, ref_text, note, lines } = parsed.data;

  // idempotency check
  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM documents WHERE idempotency_key=? AND doc_type='RECEIVE'",
  ).bind(idempotency_key).first() as { id: number; status: string } | null;
  if (existing) return c.json(buildIdempotencyResponse(existing));

  const yymm = doc_date.slice(2, 4) + doc_date.slice(5, 7);
  const doc_no = await nextDocNo(c.env.DB, "RECEIVE", yymm);
  const nowIso = new Date().toISOString();

  // resolve lot_id สำหรับแต่ละ line ที่มีข้อมูลล็อต (upsert ก่อน batch)
  const resolvedLines: Array<{ item_id: number; lot_id: number; qty_milli: number; unit_cost_x4: number }> = [];
  for (const line of lines) {
    let lot_id = 0; // sentinel 0 = ไม่มีล็อต
    if (line.lot_no) {
      await c.env.DB.prepare(
        `INSERT INTO lots (item_id, lot_no, mfg_date, expiry_date, po_no, manufacturer_name, created_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(item_id, lot_no) DO NOTHING`,
      ).bind(line.item_id, line.lot_no, line.lot_mfg_date ?? null, line.lot_expiry_date ?? null, line.lot_po_no ?? null, line.lot_manufacturer_name ?? null, nowIso).run();
      const lotRow = await c.env.DB.prepare(
        "SELECT id FROM lots WHERE item_id=? AND lot_no=?",
      ).bind(line.item_id, line.lot_no).first() as { id: number } | null;
      if (lotRow) lot_id = lotRow.id;
    }
    resolvedLines.push({ item_id: line.item_id, lot_id, qty_milli: line.qty_milli, unit_cost_x4: line.unit_cost_x4 });
  }

  // สร้าง document
  const docResult = await c.env.DB.prepare(
    `INSERT INTO documents (doc_type, doc_no, doc_date, warehouse_id, status, ref_text, note, idempotency_key, created_by)
     VALUES ('RECEIVE',?,?,?,'DRAFT',?,?,?,?)`,
  ).bind(doc_no, doc_date, warehouse_id, ref_text ?? null, note ?? null, idempotency_key, session.userId).run();

  const doc_id = docResult.meta.last_row_id;

  const snap = await loadBalanceSnapshot(c.env.DB, warehouse_id, resolvedLines);

  const { lineUpdates } = computePostDocumentUpdates(
    { doc_id, warehouse_id, movement_date: doc_date, direction: 1, lines: resolvedLines, user_id: session.userId },
    snap,
  );

  const stmts = lineUpdates.flatMap((lu) => [
    c.env.DB.prepare(
      `INSERT INTO document_lines (document_id, item_id, lot_id, qty_milli, unit_cost_x4) VALUES (?,?,?,?,?)`,
    ).bind(doc_id, lu.item_id, lu.lot_id || null, lu.qty_milli, lu.unit_cost_x4),

    c.env.DB.prepare(
      `INSERT INTO stock_movements (document_id, item_id, lot_id, warehouse_id, movement_date, direction, qty_milli, unit_cost_x4, balance_qty_after_milli, avg_cost_after_x4)
       VALUES (?,?,?,?,?,1,?,?,?,?)`,
    ).bind(doc_id, lu.item_id, lu.lot_id, warehouse_id, doc_date, lu.qty_milli, lu.unit_cost_x4, lu.new_qty, lu.new_avg_cost),

    c.env.DB.prepare(
      `INSERT INTO stock_balances (item_id, lot_id, warehouse_id, qty_on_hand_milli, avg_cost_x4, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(item_id, lot_id, warehouse_id) DO UPDATE SET
         qty_on_hand_milli=excluded.qty_on_hand_milli,
         avg_cost_x4=excluded.avg_cost_x4, updated_at=excluded.updated_at`,
    ).bind(lu.item_id, lu.lot_id, warehouse_id, lu.new_qty, lu.new_avg_cost, nowIso),
  ]);

  stmts.push(
    c.env.DB.prepare(`UPDATE documents SET status='POSTED', posted_by=?, posted_at=? WHERE id=?`)
      .bind(session.userId, nowIso, doc_id),
  );

  await c.env.DB.batch(stmts);

  return c.json({ ok: true, doc_id, doc_no });
});

// ── POST /api/documents/issue ─────────────────────────────────────────────────

docApp.post("/api/documents/issue", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid_json" }, 400);

  const parsed = issueSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_input", issues: parsed.error.issues }, 400);

  const { idempotency_key, warehouse_id, doc_date, ref_text, note, lines } = parsed.data;

  // idempotency check
  const existing = await c.env.DB.prepare(
    "SELECT id, status FROM documents WHERE idempotency_key=? AND doc_type='ISSUE'",
  ).bind(idempotency_key).first() as { id: number; status: string } | null;
  if (existing) return c.json(buildIdempotencyResponse(existing));

  // normalize lot_id: ใช้ sentinel 0 แทน null
  const linesNorm = lines.map(l => ({ ...l, lot_id: l.lot_id ?? 0 }));

  // โหลด lot info สำหรับตรวจวันหมดอายุ
  const lotIds = linesNorm.map(l => l.lot_id).filter(id => id > 0);
  let lotInfos: LotInfo[] = [];
  if (lotIds.length > 0) {
    const placeholders = lotIds.map(() => "?").join(",");
    const lotRows = await c.env.DB.prepare(
      `SELECT id, expiry_date FROM lots WHERE id IN (${placeholders})`,
    ).bind(...lotIds).all();
    lotInfos = lotRows.results as LotInfo[];
  }

  // โหลด snapshot และ validate
  const snap = await loadBalanceSnapshot(c.env.DB, warehouse_id, linesNorm);
  const today = new Date(doc_date);
  const validation = validateIssueLines(linesNorm, snap, warehouse_id, today, lotInfos);
  if (!validation.ok) {
    return c.json({ error: validation.errors.join("; "), errors: validation.errors }, 422);
  }

  // เติม unit_cost จาก avg_cost ใน snapshot (frontend ส่ง 0 เสมอ)
  const linesWithCost = linesNorm.map(l => {
    const key = `${l.item_id}:${l.lot_id}:${warehouse_id}`;
    const bal = snap.get(key);
    return { ...l, unit_cost_x4: bal?.avg_cost ?? 0 };
  });

  const yymm = doc_date.slice(2, 4) + doc_date.slice(5, 7);
  const doc_no = await nextDocNo(c.env.DB, "ISSUE", yymm);
  const nowIso = new Date().toISOString();

  const docResult = await c.env.DB.prepare(
    `INSERT INTO documents (doc_type, doc_no, doc_date, warehouse_id, status, ref_text, note, idempotency_key, created_by)
     VALUES ('ISSUE',?,?,?,'DRAFT',?,?,?,?)`,
  ).bind(doc_no, doc_date, warehouse_id, ref_text ?? null, note ?? null, idempotency_key, session.userId).run();

  const doc_id = docResult.meta.last_row_id;

  const { lineUpdates } = computePostDocumentUpdates(
    { doc_id, warehouse_id, movement_date: doc_date, direction: -1, lines: linesWithCost, user_id: session.userId },
    snap,
  );

  // ใช้ SQL WHERE qty >= ? เพื่อ concurrent safety
  const stmts = lineUpdates.flatMap((lu) => [
    c.env.DB.prepare(
      `INSERT INTO document_lines (document_id, item_id, lot_id, qty_milli, unit_cost_x4) VALUES (?,?,?,?,?)`,
    ).bind(doc_id, lu.item_id, lu.lot_id || null, lu.qty_milli, lu.unit_cost_x4),

    c.env.DB.prepare(
      `INSERT INTO stock_movements (document_id, item_id, lot_id, warehouse_id, movement_date, direction, qty_milli, unit_cost_x4, balance_qty_after_milli, avg_cost_after_x4)
       VALUES (?,?,?,?,?,-1,?,?,?,?)`,
    ).bind(doc_id, lu.item_id, lu.lot_id, warehouse_id, doc_date, lu.qty_milli, lu.unit_cost_x4, lu.new_qty, lu.new_avg_cost),

    // WHERE qty >= qty_milli ป้องกัน race condition
    c.env.DB.prepare(
      `UPDATE stock_balances SET qty_on_hand_milli=qty_on_hand_milli-?, updated_at=?
       WHERE item_id=? AND lot_id=? AND warehouse_id=? AND qty_on_hand_milli>=?`,
    ).bind(lu.qty_milli, nowIso, lu.item_id, lu.lot_id, warehouse_id, lu.qty_milli),
  ]);

  stmts.push(
    c.env.DB.prepare(`UPDATE documents SET status='POSTED', posted_by=?, posted_at=? WHERE id=?`)
      .bind(session.userId, nowIso, doc_id),
  );

  await c.env.DB.batch(stmts);

  return c.json({ ok: true, doc_id, doc_no });
});

// ── GET /api/documents ────────────────────────────────────────────────────────

docApp.get("/api/documents", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const { doc_type, warehouse_id, date_from, date_to, limit = "50", offset = "0" } = c.req.query();

  let sql = `SELECT d.id, d.doc_type, d.doc_no, d.doc_date, d.status,
               d.ref_text, d.note, d.warehouse_id, w.name as warehouse_name,
               d.created_by, u.email as created_by_email, d.posted_at
             FROM documents d
             LEFT JOIN warehouses w ON w.id=d.warehouse_id
             LEFT JOIN users u ON u.id=d.created_by
             WHERE 1=1`;
  const params: (string | number)[] = [];

  if (doc_type) { sql += " AND d.doc_type=?"; params.push(doc_type); }
  if (warehouse_id) { sql += " AND d.warehouse_id=?"; params.push(Number(warehouse_id)); }
  if (date_from) { sql += " AND d.doc_date>=?"; params.push(date_from); }
  if (date_to) { sql += " AND d.doc_date<=?"; params.push(date_to); }

  sql += " ORDER BY d.doc_date DESC, d.id DESC LIMIT ? OFFSET ?";
  params.push(Number(limit), Number(offset));

  const rows = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json({ ok: true, documents: rows.results });
});

// ── GET /api/documents/:id ────────────────────────────────────────────────────

docApp.get("/api/documents/:id", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const id = Number(c.req.param("id"));
  const doc = await c.env.DB.prepare(
    `SELECT d.*, w.name as warehouse_name FROM documents d
     LEFT JOIN warehouses w ON w.id=d.warehouse_id WHERE d.id=?`,
  ).bind(id).first();
  if (!doc) return c.json({ error: "not_found" }, 404);

  const linesRows = await c.env.DB.prepare(
    `SELECT dl.*, i.sku, i.name_th, l.lot_no, l.expiry_date
     FROM document_lines dl
     LEFT JOIN items i ON i.id=dl.item_id
     LEFT JOIN lots l ON l.id=dl.lot_id
     WHERE dl.document_id=?`,
  ).bind(id).all();

  const isOwner = session.role === "OWNER";
  const lines = linesRows.results.map((row: any) => ({
    ...row,
    unit_cost_x4: isOwner ? row.unit_cost_x4 : undefined,
  }));

  return c.json({ ok: true, document: doc, lines });
});

// ── POST /api/documents/:id/cancel ───────────────────────────────────────────

docApp.post("/api/documents/:id/cancel", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);
  if (session.role !== "OWNER") return c.json({ error: "forbidden" }, 403);

  const id = Number(c.req.param("id"));
  const doc = await c.env.DB.prepare(
    "SELECT * FROM documents WHERE id=?",
  ).bind(id).first() as { id: number; status: string; doc_type: string; warehouse_id: number; doc_date: string } | null;

  if (!doc) return c.json({ error: "not_found" }, 404);
  if (doc.status !== "POSTED") return c.json({ error: "cannot_cancel", status: doc.status }, 400);
  if (doc.doc_type === "CANCEL") return c.json({ error: "cannot_cancel_cancel" }, 400);

  const nowIso = new Date().toISOString();
  const yymm = doc.doc_date.slice(2, 4) + doc.doc_date.slice(5, 7);

  // สร้าง CANCEL document
  await c.env.DB.prepare(
    `INSERT INTO doc_sequences (doc_type, yymm, last_no) VALUES ('CANCEL',?,1)
     ON CONFLICT(doc_type, yymm) DO UPDATE SET last_no=last_no+1`,
  ).bind(yymm).run();
  const seqRow = await c.env.DB.prepare(
    "SELECT last_no FROM doc_sequences WHERE doc_type='CANCEL' AND yymm=?",
  ).bind(yymm).first() as { last_no: number };
  const cancel_no = buildDocNo("CANCEL", yymm, seqRow.last_no);

  const cancelResult = await c.env.DB.prepare(
    `INSERT INTO documents (doc_type, doc_no, doc_date, warehouse_id, status, ref_text, idempotency_key, created_by)
     VALUES ('CANCEL',?,?,?,'DRAFT',?,?,?)`,
  ).bind(cancel_no, doc.doc_date, doc.warehouse_id, `ยกเลิก ${doc.doc_type}`, `cancel-${id}`, session.userId).run();

  const cancel_id = cancelResult.meta.last_row_id;

  // โหลด lines เดิม
  const origLines = await c.env.DB.prepare(
    "SELECT item_id, lot_id, qty_milli, unit_cost_x4 FROM document_lines WHERE document_id=?",
  ).bind(id).all();

  const linesRaw = origLines.results as Array<{ item_id: number; lot_id: number | null; qty_milli: number; unit_cost_x4: number }>;
  const lines = linesRaw.map(l => ({ ...l, lot_id: l.lot_id ?? 0 }));

  // direction กลับรายการ
  const reverseDir = (doc.doc_type === "RECEIVE" ? -1 : 1) as 1 | -1;
  const snap = await loadBalanceSnapshot(c.env.DB, doc.warehouse_id, lines);

  const { lineUpdates } = computePostDocumentUpdates(
    { doc_id: cancel_id, warehouse_id: doc.warehouse_id, movement_date: doc.doc_date, direction: reverseDir, lines, user_id: session.userId },
    snap,
  );

  const stmts = lineUpdates.flatMap((lu) => [
    c.env.DB.prepare(
      `INSERT INTO document_lines (document_id, item_id, lot_id, qty_milli, unit_cost_x4) VALUES (?,?,?,?,?)`,
    ).bind(cancel_id, lu.item_id, lu.lot_id || null, lu.qty_milli, lu.unit_cost_x4),

    c.env.DB.prepare(
      `INSERT INTO stock_movements (document_id, item_id, lot_id, warehouse_id, movement_date, direction, qty_milli, unit_cost_x4, balance_qty_after_milli, avg_cost_after_x4)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(cancel_id, lu.item_id, lu.lot_id, doc.warehouse_id, doc.doc_date, reverseDir, lu.qty_milli, lu.unit_cost_x4, lu.new_qty, lu.new_avg_cost),

    c.env.DB.prepare(
      `INSERT INTO stock_balances (item_id, lot_id, warehouse_id, qty_on_hand_milli, avg_cost_x4, updated_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(item_id, lot_id, warehouse_id) DO UPDATE SET
         qty_on_hand_milli=excluded.qty_on_hand_milli, avg_cost_x4=excluded.avg_cost_x4, updated_at=excluded.updated_at`,
    ).bind(lu.item_id, lu.lot_id, doc.warehouse_id, lu.new_qty, lu.new_avg_cost, nowIso),
  ]);

  stmts.push(
    c.env.DB.prepare(`UPDATE documents SET status='CANCELLED' WHERE id=?`).bind(id),
    c.env.DB.prepare(`UPDATE documents SET status='POSTED', posted_by=?, posted_at=? WHERE id=?`)
      .bind(session.userId, nowIso, cancel_id),
  );

  await c.env.DB.batch(stmts);

  return c.json({ ok: true, cancel_id, cancel_no });
});

// ── GET /api/lots/suggest ─────────────────────────────────────────────────────

docApp.get("/api/lots/suggest", async (c) => {
  const session = c.get("session");
  if (!session) return c.json({ error: "unauthorized" }, 401);

  const { item_id, warehouse_id } = c.req.query();
  if (!item_id || !warehouse_id) return c.json({ error: "missing_params" }, 400);

  const today = new Date().toISOString().slice(0, 10);

  const rows = await c.env.DB.prepare(
    `SELECT l.id, l.lot_no, l.expiry_date, l.mfg_date, l.po_no, l.manufacturer_name,
            sb.qty_on_hand_milli, sb.avg_cost_x4,
            CASE WHEN l.expiry_date < ? THEN 1 ELSE 0 END AS is_expired
     FROM lots l
     INNER JOIN stock_balances sb ON sb.lot_id=l.id AND sb.item_id=? AND sb.warehouse_id=?
     WHERE l.item_id=? AND sb.qty_on_hand_milli > 0
     ORDER BY l.expiry_date ASC`,
  ).bind(today, Number(item_id), Number(warehouse_id), Number(item_id)).all();

  return c.json({ ok: true, lots: rows.results });
});

export default docApp;
