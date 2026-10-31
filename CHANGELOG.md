# Changelog

All notable changes to Stocki will be documented in this file.

## [Unreleased]

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
