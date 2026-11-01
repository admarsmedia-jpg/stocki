# Changelog

All notable changes to Stocki will be documented in this file.

## [Unreleased]

## [0.1.0-bugfix2] - 2026-11-01

### Fixed
- `import-service.ts`: auto-create หน่วย/คลัง ใช้ `r["หน่วย"]` และ `r["คลัง"]` แทน `r.unit_code`/`r.warehouse_code` (rows จาก Excel ใช้ key ภาษาไทย)
- `documents-service.ts`: direction `-1` อยู่ผิดตำแหน่งใน VALUES (ตำแหน่ง 5 แทนที่จะเป็น 6) ทำให้ CHECK constraint fail เมื่อตัดออก
- `Reports.tsx`: `transformRow` แปลง `_milli`/`_x4` เสมอ ไม่ใช่แค่ตอน export ทำให้ตัวเลขในหน้าจอถูกต้อง

## [0.1.0-d5] - 2026-10-31

### Added (D5 — รายงานสรุป + ทดสอบติดตั้ง)
- `src/domain/reportEngine.ts` — pure functions: filterCostFields, buildBalanceRows, buildMovementSummary, buildExpiringRows, buildReorderRows, buildExcelColumns
- `src/api/reports-service.ts` — GET /api/reports/balance, /movements, /card/:id, /lots, /expiring, /reorder, /balance/export
- `src/web/pages/Reports.tsx` — แสดงรายงาน 6 ประเภท, Export Excel (SheetJS client-side), STAFF ไม่เห็นคอลัมน์มูลค่า
- STAFF filter ตรวจที่ API layer ทั้ง JSON response และ Excel export
- 9 tests ใหม่: filterCostFields (OWNER/STAFF), buildBalanceRows, buildMovementSummary, buildExpiringRows, buildReorderRows, buildExcelColumns

## [0.1.0-d4] - 2026-10-31

### Added (D4 — รับเข้า + ตัดออก)
- `src/domain/documentEngine.ts` — pure functions: `isExpired`, `computeFEFOOrder`, `validateIssueLines`, `buildIdempotencyResponse`, `buildDocNo`
- `src/api/documents-service.ts` — POST /api/documents/receive, POST /api/documents/issue, POST /api/documents/:id/cancel, GET /api/documents, GET /api/documents/:id, GET /api/lots/suggest (FEFO)
- GET /api/warehouses, POST /api/lots (upsert) เพิ่มใน index.ts
- `src/web/pages/Receive.tsx` — หน้ารับสินค้า รองรับ keyboard wedge barcode, เตือนแป้นพิมพ์ไทย, รองรับ lot
- `src/web/pages/Issue.tsx` — หน้าตัดออก FEFO lot selector, เตือนแป้นพิมพ์ไทย
- เพิ่ม nav Receive/Issue ใน main.tsx
- `tests/documents.test.ts` — 14 test cases ครอบคลุม: moving average, validateIssueLines, FEFO order, expired lot, idempotency, concurrent safety

### Security
- ตัดออก: ใช้ SQL `WHERE qty_on_hand_milli >= ?` ป้องกัน race condition (ยอดไม่ติดลบเมื่อมีคำขอพร้อมกัน)
- Cancel: สร้าง movement กลับรายการ ไม่ลบของเดิม

## [0.1.0-d3] - 2026-10-31

### Added (D3 — นำเข้าสต็อกจาก Excel)
- POST /api/import/opening — รับ batch ≤500 แถว, idempotency-key, จัดกลุ่มตามคลัง
- validateImportRows() — ตรวจทุกกรณี: หน่วยไม่รู้จัก, จำนวนติดลบ, ซ้ำในไฟล์, ล็อตขาดข้อมูล, วันหมดอายุก่อนวันผลิต
- parseThaiDate() — รองรับ วว/ดด/ปปปป (พ.ศ./ค.ศ.) และ Excel serial number
- computePostDocumentUpdates() — คำนวณ balance ใหม่ด้วย moving average cost (pure function ไม่ depend D1)
- หน้า Import.tsx — ดาวน์โหลดแม่แบบ, อ่านไฟล์ด้วย SheetJS, ตัวอย่าง 20 แถว, รายการแถวผิด, ยืนยันนำเข้า
- 14 tests: validateImportRows (9 กรณี), parseThaiDate (5 กรณี)

## [0.1.0-d2] - 2026-10-31

### Added (D2 — ล็อกอิน + หน้าสินค้า)
- POST /api/auth/login — PBKDF2-SHA256 ≥100,000 รอบ, ล็อก 15 นาทีหลังผิด 10 ครั้ง
- POST /api/auth/logout, GET /api/auth/me
- GET/POST/PUT /api/items — ค้นด้วยชื่อหรือบาร์โค้ด, audit_logs ทุกครั้ง
- STAFF เรียกข้อมูลต้นทุน → 403 (ตรวจที่ API)
- Cookie: HttpOnly; Secure; SameSite=Lax
- GET /api/setup/status + POST /api/setup/init (first-run)
- Frontend: หน้า Setup, Login, Items (React + Zustand + Tailwind)

## [0.1.0-d1] - 2026-10-31

### Added (D1 — โครงโปรเจกต์ + ฐานข้อมูล)
- โครงโฟลเดอร์ครบ: src/api, src/domain, src/db, src/web, migrations, tests, e2e
- package.json พร้อม scripts ทุกอัน (dev, typecheck, lint, test, e2e, db:reset, db:migrate, db:migrate:remote, secrets:scan, deploy)
- wrangler.jsonc — ไม่มี database_id ตายตัว (placeholder 00000000)
- Drizzle schema ครบ 14 ตาราง (src/db/schema.ts)
- migration/0000_init.sql — รันบน D1 local สำเร็จ
- GET /api/health → {"ok":true}
- Vitest tests: health shape + schema integrity (movements sum = balances, ห้ามยอดติดลบ)
- .gitignore รวม .dev.vars, node_modules, .wrangler
- React + Vite + Tailwind frontend skeleton
