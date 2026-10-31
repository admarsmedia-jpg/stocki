/**
 * documentEngine.ts — pure functions สำหรับ D4: receive/issue
 * ไม่ depend HTTP หรือ D1 โดยตรง
 */

export type IssueLine = {
  item_id: number;
  lot_id: number | null;
  qty_milli: number;
};

export type LotInfo = {
  id: number;
  expiry_date: string; // YYYY-MM-DD
};

import type { BalanceSnapshot } from "./postDocument";
export type BalanceMap = BalanceSnapshot;

/** ตรวจว่าล็อตหมดอายุแล้วหรือยัง (expiry_date < today) */
export function isExpired(expiry_date: string, today: Date): boolean {
  const exp = new Date(expiry_date + "T00:00:00Z");
  const tod = new Date(today.toISOString().slice(0, 10) + "T00:00:00Z");
  return exp < tod;
}

/** เรียงล็อตตาม FEFO (หมดก่อน = อยู่หน้า) */
export function computeFEFOOrder<T extends { id: number; expiry_date: string }>(lots: T[]): T[] {
  return [...lots].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
}

/** ตรวจ lines ก่อน issue:
 *  - ยอดเพียงพอ
 *  - ล็อตไม่หมดอายุ
 *  คืน { ok, errors }
 */
export function validateIssueLines(
  lines: IssueLine[],
  snapshot: BalanceMap,
  warehouse_id: number,
  today: Date,
  lotInfos: LotInfo[] = [],
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const lotMap = new Map(lotInfos.map(l => [l.id, l]));

  for (const line of lines) {
    const key = `${line.item_id}:${line.lot_id ?? "null"}:${warehouse_id}`;
    const bal = snapshot.get(key) ?? { qty: 0, avg_cost: 0 };

    if (bal.qty < line.qty_milli) {
      errors.push(`item_id=${line.item_id} lot_id=${line.lot_id}: ยอดไม่เพียงพอ (มี ${bal.qty} ต้องการ ${line.qty_milli})`);
    }

    if (line.lot_id !== null) {
      const lot = lotMap.get(line.lot_id);
      if (lot && isExpired(lot.expiry_date, today)) {
        errors.push(`item_id=${line.item_id} lot_id=${line.lot_id}: ล็อตหมดอายุแล้ว (${lot.expiry_date})`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** สร้าง response สำหรับ idempotency hit */
export function buildIdempotencyResponse(existing: { id: number; status: string }) {
  return { ok: true, idempotent: true, doc_id: existing.id, status: existing.status };
}

/** สร้างเลขเอกสาร เช่น RCV-2610-0001 */
export function buildDocNo(docType: "RECEIVE" | "ISSUE" | "OPENING" | "CANCEL", yymm: string, seq: number): string {
  const prefix = { RECEIVE: "RCV", ISSUE: "ISS", OPENING: "OPN", CANCEL: "CAN" }[docType];
  return `${prefix}-${yymm}-${String(seq).padStart(4, "0")}`;
}
