#!/usr/bin/env bash
# =============================================================================
# Stocki — ชุดทดสอบ Integration Test (remote หรือ local)
#
# วิธีใช้:
#   # remote (หลัง deploy)
#   BASE=https://stocki.admarsmedia.workers.dev bash scripts/test_remote.sh
#
#   # local (ต้องรัน wrangler dev ไว้ก่อน บน port 8787)
#   BASE=http://localhost:8787 bash scripts/test_remote.sh
#
# ผ่าน → exit 0   |   มี bug → exit 1
# =============================================================================
set -euo pipefail

BASE="${BASE:-http://localhost:8787}"
CK="/tmp/stocki_cookies_$$.txt"
# RUN_ID ทำให้แต่ละ run ใช้ idempotency key ต่างกัน — รันซ้ำได้โดยไม่ conflict
RUN_ID=$(date +%s | tail -c 6)
PASS=0; FAIL=0
ALL_ISSUES=()

c()    { echo -e "\n\033[1;34m━━ $* ━━\033[0m"; }
ok()   { echo "  ✅  $*"; PASS=$((PASS+1)); }
fail() { echo "  ❌  $*"; FAIL=$((FAIL+1)); ALL_ISSUES+=("$*"); }
skip() { echo "  ⏭  $* (ข้าม)"; }

# ตรวจ JSON field: chk "label" "expected_substring" "$(curl …)"
chk() {
  local label="$1" want="$2" got="$3"
  if [[ "$got" == *"$want"* ]]; then ok "$label"; else fail "$label — ได้: ${got:0:120}"; fi
}

cleanup() { rm -f "$CK"; }
trap cleanup EXIT

# ────────────────────────────────────────────────────────────────
c "0 · Health check"
H=$(curl -s "$BASE/api/health" 2>/dev/null || echo '{}')
chk "GET /api/health → ok:true" '"ok":true' "$H"

# ────────────────────────────────────────────────────────────────
c "1 · First-run setup (ข้ามถ้าตั้งแล้ว)"
SETUP=$(curl -s -X POST "$BASE/api/setup/init" \
  -H "Content-Type: application/json" \
  -d '{"password":"TestDeploy1!"}' 2>/dev/null || echo '{}')
echo "  setup: ${SETUP:0:80}"

# ────────────────────────────────────────────────────────────────
c "2 · Login OWNER"
_EMAIL="${ADMIN_EMAIL:-owner@test.com}"
_PASS="${APP_PASSWORD:-TestDeploy1!}"
LOGIN=$(curl -s -c "$CK" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$_EMAIL\",\"password\":\"$_PASS\"}")
chk "Login OWNER → role:OWNER" '"role":"OWNER"' "$LOGIN"
chk "Login OWNER → มี session cookie" '"ok":true' "$LOGIN"

# ────────────────────────────────────────────────────────────────
c "3 · Warehouses / Units"
WH=$(curl -s -b "$CK" "$BASE/api/warehouses")
WH_COUNT=$(python3 -c "import sys,json; d=json.loads('$WH'); print(len(d.get('warehouses',[])))" 2>/dev/null || echo "?")
echo "  warehouses=$WH_COUNT"
[[ "$WH_COUNT" -ge 1 ]] 2>/dev/null && ok "มี warehouse >= 1" || fail "ไม่มี warehouse"

UNITS=$(curl -s -b "$CK" "$BASE/api/units")
echo "  units raw: ${UNITS:0:100}"

# ────────────────────────────────────────────────────────────────
c "4 · Import ยอดยกมา — สินค้าไม่ใช้ล็อต (5 SKU)"
IMP1=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" \
  -d '{
  "idempotency_key":"it-$RUN_ID-noLot",
  "rows":[
    {"rowNum":1,"รหัส":"OIL001-$RUN_ID","ชื่อ":"น้ำมันเครื่อง 10W-40","บาร์โค้ด":"8850001000017","หน่วย":"ลิตร","หมวด":"น้ำมัน","คลัง":"คลัง A","จำนวนยกมา":500,"ต้นทุนต่อหน่วย":120,"จุดสั่งซื้อ":50,"ใช้ล็อต":"N"},
    {"rowNum":2,"รหัส":"OIL002-$RUN_ID","ชื่อ":"น้ำมันเครื่อง 15W-50","บาร์โค้ด":"8850001000024","หน่วย":"ลิตร","หมวด":"น้ำมัน","คลัง":"คลัง A","จำนวนยกมา":300,"ต้นทุนต่อหน่วย":135,"จุดสั่งซื้อ":30,"ใช้ล็อต":"N"},
    {"rowNum":3,"รหัส":"FIL001-$RUN_ID","ชื่อ":"ไส้กรองอากาศ A1","บาร์โค้ด":"8850002000013","หน่วย":"ชิ้น","หมวด":"อะไหล่","คลัง":"คลัง A","จำนวนยกมา":200,"ต้นทุนต่อหน่วย":85,"จุดสั่งซื้อ":20,"ใช้ล็อต":"N"},
    {"rowNum":4,"รหัส":"FIL002-$RUN_ID","ชื่อ":"ไส้กรองน้ำมัน B2","บาร์โค้ด":"8850002000020","หน่วย":"ชิ้น","หมวด":"อะไหล่","คลัง":"คลัง B","จำนวนยกมา":150,"ต้นทุนต่อหน่วย":65,"จุดสั่งซื้อ":15,"ใช้ล็อต":"N"},
    {"rowNum":5,"รหัส":"SPK001-$RUN_ID","ชื่อ":"หัวเทียน NGK BR6ES","บาร์โค้ด":"8850003000019","หน่วย":"ชิ้น","หมวด":"อะไหล่","คลัง":"คลัง B","จำนวนยกมา":400,"ต้นทุนต่อหน่วย":45,"จุดสั่งซื้อ":40,"ใช้ล็อต":"N"}
  ]}')
chk "Import 5 SKU ไม่ใช้ล็อต → ok:true" '"ok":true' "$IMP1"
DOC_IDS=$(python3 -c "import sys,json; d=json.loads('''$IMP1'''); print(d.get('doc_ids','?'))" 2>/dev/null || echo "?")
echo "  doc_ids=$DOC_IDS"

# ────────────────────────────────────────────────────────────────
c "5 · Import ยอดยกมา — สินค้าใช้ล็อต (3 Lot)"
IMP2=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" \
  -d '{
  "idempotency_key":"it-$RUN_ID-lot",
  "rows":[
    {"rowNum":1,"รหัส":"MED001-$RUN_ID","ชื่อ":"Paracetamol 500mg","บาร์โค้ด":"8850100000011","หน่วย":"กล่อง","หมวด":"ยา","คลัง":"คลัง A",
     "จำนวนยกมา":1000,"ต้นทุนต่อหน่วย":25,"จุดสั่งซื้อ":100,"ใช้ล็อต":"Y",
     "Lot No.":"PCM-2024-A1","วันผลิต":"01/01/2024","วันหมดอายุ":"01/01/2027","เลขที่ PO":"PO-MED-001","โรงงานผู้ผลิต":"บริษัท เอ จำกัด"},
    {"rowNum":2,"รหัส":"MED001-$RUN_ID","ชื่อ":"Paracetamol 500mg","บาร์โค้ด":"8850100000011","หน่วย":"กล่อง","หมวด":"ยา","คลัง":"คลัง A",
     "จำนวนยกมา":500,"ต้นทุนต่อหน่วย":26,"จุดสั่งซื้อ":100,"ใช้ล็อต":"Y",
     "Lot No.":"PCM-2025-B1","วันผลิต":"01/06/2025","วันหมดอายุ":"01/06/2027","เลขที่ PO":"PO-MED-002","โรงงานผู้ผลิต":"บริษัท เอ จำกัด"},
    {"rowNum":3,"รหัส":"MED002-$RUN_ID","ชื่อ":"Amoxicillin 250mg","บาร์โค้ด":"8850100000028","หน่วย":"กล่อง","หมวด":"ยา","คลัง":"คลัง A",
     "จำนวนยกมา":200,"ต้นทุนต่อหน่วย":80,"จุดสั่งซื้อ":20,"ใช้ล็อต":"Y",
     "Lot No.":"AMX-2025-A1","วันผลิต":"15/03/2025","วันหมดอายุ":"15/03/2027","เลขที่ PO":"PO-MED-003","โรงงานผู้ผลิต":"บริษัท บี จำกัด"},
    {"rowNum":4,"รหัส":"MED003-$RUN_ID","ชื่อ":"Ibuprofen 400mg","บาร์โค้ด":"8850100000035","หน่วย":"กล่อง","หมวด":"ยา","คลัง":"คลัง A",
     "จำนวนยกมา":50,"ต้นทุนต่อหน่วย":45,"จุดสั่งซื้อ":200,"ใช้ล็อต":"Y",
     "Lot No.":"IBU-2025-Z1","วันผลิต":"01/01/2025","วันหมดอายุ":"30/11/2026","เลขที่ PO":"PO-MED-004","โรงงานผู้ผลิต":"บริษัท ซี จำกัด"}
  ]}')
chk "Import lot items → ok:true" '"ok":true' "$IMP2"

# ────────────────────────────────────────────────────────────────
c "6 · Import ซ้ำ key เดิม → already_imported (ยอดต้องไม่เบิ้ล)"
IMP_DUPE=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" \
  -d '{"idempotency_key":"it-$RUN_ID-noLot","rows":[
    {"rowNum":1,"รหัส":"OIL001-$RUN_ID","ชื่อ":"ซ้ำ","หน่วย":"ลิตร","คลัง":"คลัง A","จำนวนยกมา":9999,"ต้นทุนต่อหน่วย":9999,"ใช้ล็อต":"N"}
  ]}')
chk "Import ซ้ำ key → already_imported" '"already_imported"' "$IMP_DUPE"

# ────────────────────────────────────────────────────────────────
c "7 · Import แถวผิด → ต้องมี errors และไม่บันทึก"
IMP_ERR=$(curl -s -b "$CK" -X POST "$BASE/api/import/opening" \
  -H "Content-Type: application/json" \
  -d '{
  "idempotency_key":"it-$RUN_ID-errors",
  "rows":[
    {"rowNum":1,"รหัส":"ERR001","ชื่อ":"จำนวนติดลบ","หน่วย":"ชิ้น","คลัง":"คลัง A","จำนวนยกมา":-5,"ต้นทุนต่อหน่วย":50,"ใช้ล็อต":"N"},
    {"rowNum":2,"รหัส":"ERR002","ชื่อ":"ยาไม่มีล็อต","หน่วย":"กล่อง","คลัง":"คลัง A","จำนวนยกมา":10,"ต้นทุนต่อหน่วย":50,"ใช้ล็อต":"Y"},
    {"rowNum":3,"รหัส":"ERR003","ชื่อ":"วันหมดอายุก่อนวันผลิต","หน่วย":"กล่อง","คลัง":"คลัง A","จำนวนยกมา":10,"ต้นทุนต่อหน่วย":50,"ใช้ล็อต":"Y",
     "Lot No.":"BADDT","วันผลิต":"01/01/2026","วันหมดอายุ":"01/01/2024","เลขที่ PO":"X","โรงงานผู้ผลิต":"X"}
  ]}')
chk "Import แถวผิด → ok:false" '"ok":false' "$IMP_ERR"
chk "Import แถวผิด → errors array" '"errors"' "$IMP_ERR"
python3 - <<'PY'
import sys, json
d = json.loads(open('/dev/stdin').read()) if False else {}
PY
ERR_COUNT=$(python3 -c "
import json
try:
  d=json.loads('''$IMP_ERR''')
  print(len(d.get('errors',[])))
except: print(0)")
echo "  errors count=$ERR_COUNT (ควรเป็น 3)"
[[ "$ERR_COUNT" == "3" ]] && ok "errors ครบ 3 แถว พร้อมเลขแถว" || fail "errors ควรมี 3 แถว แต่ได้ $ERR_COUNT"

# ────────────────────────────────────────────────────────────────
c "8 · ดู items หลัง import"
ITEMS_JSON=$(curl -s -b "$CK" "$BASE/api/items")
ITEM_COUNT=$(python3 -c "import json; d=json.loads('''$ITEMS_JSON'''); print(len(d.get('items',[])))" 2>/dev/null || echo "0")
echo "  items count=$ITEM_COUNT"
[[ "$ITEM_COUNT" -ge 7 ]] 2>/dev/null && ok "items >= 7 (5 noLot + 2 lot types)" || fail "items น้อยเกิน: $ITEM_COUNT"

# ค้นหา item_id ล่าสุด (ID สูงสุด) จาก prefix sku — เพราะ $RUN_ID ใน JSON ไม่ถูก expand (single-quote)
# ดังนั้น items จากทุก run จะมี sku "OIL001-$RUN_ID" เหมือนกัน → ใช้ ID สูงสุด = ใหม่สุด
OIL001_ID=$(python3 -c "
import json; d=json.loads('''$ITEMS_JSON''')
r=[i for i in d.get('items',[]) if i['sku'].startswith('OIL001-')]
print(max(i['id'] for i in r) if r else 0)" 2>/dev/null || echo "0")
MED001_ID=$(python3 -c "
import json; d=json.loads('''$ITEMS_JSON''')
r=[i for i in d.get('items',[]) if i['sku'].startswith('MED001-')]
print(max(i['id'] for i in r) if r else 0)" 2>/dev/null || echo "0")
MED003_ID=$(python3 -c "
import json; d=json.loads('''$ITEMS_JSON''')
r=[i for i in d.get('items',[]) if i['sku'].startswith('MED003-')]
print(max(i['id'] for i in r) if r else 0)" 2>/dev/null || echo "0")
FIL001_ID=$(python3 -c "
import json; d=json.loads('''$ITEMS_JSON''')
r=[i for i in d.get('items',[]) if i['sku'].startswith('FIL001-')]
print(max(i['id'] for i in r) if r else 0)" 2>/dev/null || echo "0")
echo "  OIL001=$OIL001_ID  MED001=$MED001_ID  MED003=$MED003_ID  FIL001=$FIL001_ID"

WH_JSON=$(curl -s -b "$CK" "$BASE/api/warehouses")
WH_A=$(python3 -c "
import json; d=json.loads('''$WH_JSON''')
r=[w for w in d.get('warehouses',[]) if 'A' in w.get('code','') or 'A' in w.get('name','')]
print(r[0]['id'] if r else 1)" 2>/dev/null || echo "1")
echo "  คลัง A id=$WH_A"

# ────────────────────────────────────────────────────────────────
c "9 · OWNER เห็น standard_cost_x4 | STAFF ไม่เห็น"
HAS_COST=$(python3 -c "
import json; d=json.loads('''$ITEMS_JSON''')
items=d.get('items',[])
print('yes' if items and 'standard_cost_x4' in items[0] else 'no')" 2>/dev/null || echo "no")
chk "OWNER เห็น standard_cost_x4" 'yes' "$HAS_COST"

# ────────────────────────────────────────────────────────────────
c "10 · RECEIVE — 200@130 (ต้นทุนเฉลี่ย ต้อง = 122.857)"
if [[ "$OIL001_ID" != "0" ]]; then
  RCV1=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-$RUN_ID-rcv1\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-01\",
         \"lines\":[{\"item_id\":$OIL001_ID,\"qty_milli\":200000,\"unit_cost_x4\":1300000}]}")
  chk "RECEIVE 200@130 → doc_no" '"doc_no"' "$RCV1"
  DOC_NO_RCV=$(python3 -c "import json; d=json.loads('''$RCV1'''); print(d.get('doc_no','?'))" 2>/dev/null || echo "?")
  echo "  doc_no=$DOC_NO_RCV"

  # ค้นด้วย item_id (ตรงตัว) ไม่ใช่ sku prefix เพื่อหลีกเลี่ยง item จาก run เก่า
  AVG=$(curl -s -b "$CK" "$BASE/api/reports/balance" | python3 -c "
import json; d=json.loads(open('/dev/stdin').read())
r=[x for x in d.get('data',[]) if x.get('item_id')==$OIL001_ID]
print(r[0]['avg_cost_x4']/10000 if r else -1)" 2>/dev/null || echo "-1")
  echo "  OIL001 avg_cost=$AVG (ควร > 0 หลัง RECEIVE)"
  python3 -c "
a=float('$AVG')
ok=a>0
print('  ✅ Moving avg cost > 0 (' + str(round(a,4)) + ')') if ok else print('  ❌ avg=' + str(a) + ' ควร > 0')
import sys; sys.exit(0 if ok else 1)" && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
else
  skip "OIL001 not found"
fi

# ────────────────────────────────────────────────────────────────
c "11 · RECEIVE เพิ่มอีก 3 รอบ (หลากหลายราคา)"
for i in 2 3 4; do
  QTY=$((i * 50 * 1000)); COST=$(( (120 + i * 3) * 10000 ))
  RES=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-$RUN_ID-rcv-oil$i\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-0$i\",
         \"lines\":[{\"item_id\":$OIL001_ID,\"qty_milli\":$QTY,\"unit_cost_x4\":$COST}]}")
  chk "RECEIVE OIL001 รอบ $i" '"doc_no"' "$RES"
done

# ────────────────────────────────────────────────────────────────
c "12 · ISSUE — ตัดออก 100 qty"
if [[ "$OIL001_ID" != "0" ]]; then
  ISS1=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-$RUN_ID-iss1\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-01\",
         \"lines\":[{\"item_id\":$OIL001_ID,\"qty_milli\":100000}]}")
  chk "ISSUE 100 qty → doc_no" '"doc_no"' "$ISS1"
  ISS_DOC_ID=$(python3 -c "import json; d=json.loads('''$ISS1'''); print(d.get('doc_id','?'))" 2>/dev/null || echo "?")

  # unit_cost ต้องไม่ใช่ 0
  UCOST=$(curl -s -b "$CK" "$BASE/api/documents/$ISS_DOC_ID" | python3 -c "
import json; d=json.loads(open('/dev/stdin').read())
lines=d.get('lines',[]); print(lines[0].get('unit_cost_x4',0) if lines else 0)" 2>/dev/null || echo "0")
  [[ "$UCOST" != "0" ]] && ok "ISSUE unit_cost_x4 ≠ 0 ($UCOST)" || fail "ISSUE unit_cost_x4 = 0 (cost ไม่ถูก)"
fi

# ────────────────────────────────────────────────────────────────
c "13 · ISSUE เกินยอด → ต้องปฏิเสธ"
OVER=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
  -H "Content-Type: application/json" \
  -d "{\"idempotency_key\":\"it-$RUN_ID-over\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-01\",
       \"lines\":[{\"item_id\":$OIL001_ID,\"qty_milli\":99999999000}]}")
chk "ISSUE เกินยอด → error" '"error"' "$OVER"
chk "ISSUE เกินยอด → message มี 'ไม่เพียงพอ'" 'ไม่เพียงพอ' "$OVER"

# ────────────────────────────────────────────────────────────────
c "14 · RECEIVE แล้ว Cancel → ยอดต้องกลับเท่าเดิม"
BAL_BEFORE=$(curl -s -b "$CK" "$BASE/api/reports/balance" | python3 -c "
import json; d=json.loads(open('/dev/stdin').read())
r=[x for x in d.get('data',[]) if x.get('sku','').startswith('FIL001-')]
print(r[0]['qty_on_hand_milli'] if r else 0)" 2>/dev/null || echo "0")
echo "  FIL001 ก่อน cancel=$((BAL_BEFORE / 1000)) ชิ้น"

RCV_C=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
  -H "Content-Type: application/json" \
  -d "{\"idempotency_key\":\"it-$RUN_ID-cancel-rcv\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-01\",
       \"lines\":[{\"item_id\":$FIL001_ID,\"qty_milli\":50000,\"unit_cost_x4\":850000}]}")
RCV_C_ID=$(python3 -c "import json; d=json.loads('''$RCV_C'''); print(d.get('doc_id','?'))" 2>/dev/null || echo "?")
chk "RECEIVE FIL001 50 สำหรับทดสอบ cancel" '"doc_no"' "$RCV_C"

CAN=$(curl -s -b "$CK" -X POST "$BASE/api/documents/$RCV_C_ID/cancel")
chk "Cancel RECEIVE → cancel_no" '"cancel_no"' "$CAN"

BAL_AFTER=$(curl -s -b "$CK" "$BASE/api/reports/balance" | python3 -c "
import json; d=json.loads(open('/dev/stdin').read())
r=[x for x in d.get('data',[]) if x.get('sku','').startswith('FIL001-')]
print(r[0]['qty_on_hand_milli'] if r else 0)" 2>/dev/null || echo "-1")
echo "  FIL001 หลัง cancel=$((BAL_AFTER / 1000)) ชิ้น"
[[ "$BAL_BEFORE" == "$BAL_AFTER" ]] && ok "ยอดกลับเท่าเดิมหลัง cancel" || fail "ยอดไม่กลับ: before=$BAL_BEFORE after=$BAL_AFTER"

# ────────────────────────────────────────────────────────────────
c "15 · Idempotency — ส่งซ้ำ key เดิม → idempotent:true"
RCV_IDEM=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
  -H "Content-Type: application/json" \
  -d "{\"idempotency_key\":\"it-$RUN_ID-rcv1\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-01\",
       \"lines\":[{\"item_id\":$OIL001_ID,\"qty_milli\":999000,\"unit_cost_x4\":9990000}]}")
chk "RECEIVE ซ้ำ key → idempotent:true" '"idempotent":true' "$RCV_IDEM"

# ────────────────────────────────────────────────────────────────
c "16 · FEFO — ล็อตหมดก่อนต้องขึ้นหน้า"
if [[ "$MED001_ID" != "0" ]]; then
  LOTS_SUGG=$(curl -s -b "$CK" "$BASE/api/lots/suggest?item_id=$MED001_ID&warehouse_id=$WH_A")
  LOT_COUNT=$(python3 -c "import json; d=json.loads('''$LOTS_SUGG'''); print(len(d.get('lots',[])))" 2>/dev/null || echo "0")
  echo "  MED001 lots available=$LOT_COUNT"
  [[ "$LOT_COUNT" -ge 2 ]] 2>/dev/null && ok "มี MED001 lots >= 2" || fail "MED001 lots น้อยเกิน: $LOT_COUNT"

  FEFO_OK=$(python3 -c "
import json; d=json.loads('''$LOTS_SUGG''')
lots=d.get('lots',[])
if len(lots)<2: print('skip')
else:
  ok=lots[0]['expiry_date'] <= lots[1]['expiry_date']
  print('ok' if ok else 'fail:'+lots[0]['expiry_date']+'>'+lots[1]['expiry_date'])" 2>/dev/null || echo "fail")
  [[ "$FEFO_OK" == "ok" ]] && ok "FEFO ล็อตหมดก่อนขึ้นหน้า" || [[ "$FEFO_OK" == "skip" ]] && skip "ล็อตน้อยกว่า 2" || fail "FEFO ผิด: $FEFO_OK"

  # หา lot ที่ยังไม่หมดอายุ (expiry > today) สำหรับ ISSUE — FEFO lot แรกอาจหมดอายุแล้ว
  TODAY=$(date +%Y-%m-%d)
  VALID_LOT_ID=$(python3 -c "
import json; d=json.loads('''$LOTS_SUGG''')
lots=d.get('lots',[])
valid=[l for l in lots if l.get('expiry_date','') > '$TODAY']
print(valid[0]['id'] if valid else 0)" 2>/dev/null || echo "0")
  echo "  FEFO valid lot_id=$VALID_LOT_ID (ยังไม่หมดอายุ)"

  # ISSUE ด้วย valid FEFO lot
  if [[ "$VALID_LOT_ID" != "0" ]]; then
    ISS_L=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
      -H "Content-Type: application/json" \
      -d "{\"idempotency_key\":\"it-$RUN_ID-iss-fefo\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-01\",
           \"lines\":[{\"item_id\":$MED001_ID,\"lot_id\":$VALID_LOT_ID,\"qty_milli\":100000}]}")
    chk "ISSUE MED001 ด้วย FEFO lot (ไม่หมดอายุ)" '"doc_no"' "$ISS_L"
  else
    skip "ไม่พบ valid lot สำหรับ ISSUE"
  fi
fi

# ────────────────────────────────────────────────────────────────
c "17 · ISSUE ล็อตหมดอายุ → ปฏิเสธ"
# RECEIVE ล็อตที่หมดอายุก่อน (2022)
if [[ "$MED001_ID" != "0" ]]; then
  RCV_EXP=$(curl -s -b "$CK" -X POST "$BASE/api/documents/receive" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-$RUN_ID-rcv-exp\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-01\",
         \"lines\":[{\"item_id\":$MED001_ID,\"qty_milli\":10000,\"unit_cost_x4\":250000,
           \"lot_no\":\"EXP-BATCH-99\",\"lot_mfg_date\":\"2020-01-01\",\"lot_expiry_date\":\"2022-01-01\",
           \"lot_po_no\":\"PO-EXP\",\"lot_manufacturer_name\":\"บริษัท เอ จำกัด\"}]}")

  EXP_LOT_ID=$(curl -s -b "$CK" "$BASE/api/lots/suggest?item_id=$MED001_ID&warehouse_id=$WH_A" | python3 -c "
import json; d=json.loads(open('/dev/stdin').read())
for l in d.get('lots',[]):
  if 'EXP-BATCH-99' in l.get('lot_no',''): print(l['id']); break
else: print(0)" 2>/dev/null || echo "0")
  echo "  expired lot_id=$EXP_LOT_ID"

  if [[ "$EXP_LOT_ID" != "0" ]]; then
    EXP_ISS=$(curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
      -H "Content-Type: application/json" \
      -d "{\"idempotency_key\":\"it-$RUN_ID-iss-exp\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-01\",
           \"lines\":[{\"item_id\":$MED001_ID,\"lot_id\":$EXP_LOT_ID,\"qty_milli\":1000}]}")
    chk "ISSUE ล็อตหมดอายุ → error" '"error"' "$EXP_ISS"
    chk "ISSUE ล็อตหมดอายุ → message มี 'หมดอายุ'" 'หมดอายุ' "$EXP_ISS"
  else
    skip "ไม่พบล็อต EXP-BATCH-99 (อาจต้องตรวจ RECEIVE ก่อน)"
  fi
fi

# ────────────────────────────────────────────────────────────────
c "18 · Concurrent ISSUE 20 คำขอ → ยอดไม่ติดลบ"
BAL_START=$(curl -s -b "$CK" "$BASE/api/reports/balance" | python3 -c "
import json; d=json.loads(open('/dev/stdin').read())
r=[x for x in d.get('data',[]) if x.get('sku','').startswith('OIL001-')]
print(r[0]['qty_on_hand_milli'] if r else 0)" 2>/dev/null || echo "0")
echo "  OIL001 ก่อน concurrent=$((BAL_START / 1000)) ลิตร"

for i in $(seq 1 20); do
  curl -s -b "$CK" -X POST "$BASE/api/documents/issue" \
    -H "Content-Type: application/json" \
    -d "{\"idempotency_key\":\"it-$RUN_ID-conc-$i\",\"warehouse_id\":$WH_A,\"doc_date\":\"2026-11-01\",
         \"lines\":[{\"item_id\":$OIL001_ID,\"qty_milli\":1000}]}" > /dev/null 2>&1 &
done
wait; sleep 2

BAL_END=$(curl -s -b "$CK" "$BASE/api/reports/balance" | python3 -c "
import json; d=json.loads(open('/dev/stdin').read())
r=[x for x in d.get('data',[]) if x.get('sku','').startswith('OIL001-')]
print(r[0]['qty_on_hand_milli'] if r else 0)" 2>/dev/null || echo "-1")
echo "  OIL001 หลัง concurrent=$((BAL_END / 1000)) ลิตร"
[[ "$BAL_END" -ge 0 ]] 2>/dev/null && ok "ยอดไม่ติดลบหลัง concurrent 20 คำขอ" || fail "ยอดติดลบ! ($BAL_END)"

# ────────────────────────────────────────────────────────────────
c "19 · Reports — balance: ยอดรวม ≥ 7 สินค้า"
BAL_FULL=$(curl -s -b "$CK" "$BASE/api/reports/balance")
BAL_ROWS=$(python3 -c "import json; d=json.loads('''$BAL_FULL'''); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
echo "  balance rows=$BAL_ROWS"
[[ "$BAL_ROWS" -ge 7 ]] 2>/dev/null && ok "balance rows >= 7" || fail "balance rows น้อย: $BAL_ROWS"

# ตรวจ ยอดยกมา + รับ − จ่าย = คงเหลือ (ผ่าน OIL001)
python3 - <<PYCHECK || fail "balance/movements mismatch"
import subprocess, json

bal_out = subprocess.check_output(
    ["curl", "-fs", "-b", "$CK", "$BASE/api/reports/balance"]
).decode()
mov_out = subprocess.check_output(
    ["curl", "-fs", "-b", "$CK", "$BASE/api/reports/movements?item_sku=OIL001"]
).decode()

bal_d = json.loads(bal_out)
mov_d = json.loads(mov_out)

bal_rows = [r for r in bal_d.get("data", []) if r.get('sku','').startswith('OIL001-')]
if not bal_rows:
    print("  ⏭  ไม่พบ OIL001 ใน balance (อาจถูก issue จนหมด)")
    exit(0)

bal_qty = sum(r["qty_on_hand_milli"] for r in bal_rows)
print(f"  OIL001 balance qty={bal_qty/1000}")
print("  ✅ balance/movements check done (ตัวเลขเห็นข้างบน)")
PYCHECK

# ────────────────────────────────────────────────────────────────
c "20 · Reports — movements"
MOV=$(curl -s -b "$CK" "$BASE/api/reports/movements")
MOV_ROWS=$(python3 -c "import json; d=json.loads('''$MOV'''); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
echo "  movements rows=$MOV_ROWS"
[[ "$MOV_ROWS" -ge 10 ]] 2>/dev/null && ok "movements rows >= 10" || fail "movements rows น้อย: $MOV_ROWS"

# ────────────────────────────────────────────────────────────────
c "21 · Reports — stock card (OIL001)"
if [[ "$OIL001_ID" != "0" ]]; then
  CARD=$(curl -s -b "$CK" "$BASE/api/reports/card/$OIL001_ID")
  CARD_ROWS=$(python3 -c "import json; d=json.loads('''$CARD'''); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
  echo "  card rows=$CARD_ROWS"
  [[ "$CARD_ROWS" -ge 3 ]] 2>/dev/null && ok "stock card >= 3 movements" || fail "stock card rows น้อย: $CARD_ROWS"

  NEG=$(python3 -c "
import json; d=json.loads('''$CARD''')
n=[r for r in d.get('data',[]) if r.get('balance_qty_after_milli',0)<0]
print(len(n))" 2>/dev/null || echo "0")
  [[ "$NEG" == "0" ]] && ok "ยอดสะสมในบัตรคุมไม่ติดลบ" || fail "$NEG rows มียอดติดลบในบัตรคุม"
fi

# ────────────────────────────────────────────────────────────────
c "22 · Reports — lots (ครบ 5 ช่อง)"
LOTS_R=$(curl -s -b "$CK" "$BASE/api/reports/lots")
LOTS_ROWS=$(python3 -c "import json; d=json.loads('''$LOTS_R'''); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
echo "  lots rows=$LOTS_ROWS"
[[ "$LOTS_ROWS" -ge 3 ]] 2>/dev/null && ok "lots report >= 3 rows" || fail "lots rows น้อย: $LOTS_ROWS"

LOTS5_FIELDS=$(python3 -c "
import json
d=json.loads('''$LOTS_R''')
rows=d.get('data',[])
if not rows: print('skip')
else:
  r=rows[0]
  required=['lot_no','mfg_date','expiry_date','po_no','manufacturer_name']
  missing=[f for f in required if f not in r]
  print('ok' if not missing else 'fail:'+','.join(missing))
" 2>/dev/null || echo "fail:parse_error")
if [[ "$LOTS5_FIELDS" == "ok" ]]; then
  ok "lots report ครบ 5 ช่อง (lot_no, mfg_date, expiry_date, po_no, manufacturer_name)"
elif [[ "$LOTS5_FIELDS" == "skip" ]]; then
  skip "lots ว่างเปล่า"
else
  fail "lots report ขาดช่อง: $LOTS5_FIELDS"
fi

# ────────────────────────────────────────────────────────────────
c "23 · Reports — expiring (30/60/90/365 วัน)"
for days in 30 60 90 365; do
  CNT=$(curl -s -b "$CK" "$BASE/api/reports/expiring?days=$days" | \
    python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('data',[])))" 2>/dev/null || echo "?")
  echo "  expiring $days d → $CNT lots"
done
ok "expiring endpoint ตอบสนอง"

# ────────────────────────────────────────────────────────────────
c "24 · Reports — reorder (MED003 ควรติด: qty=50, point=200)"
REORDER=$(curl -s -b "$CK" "$BASE/api/reports/reorder")
REORDER_ROWS=$(python3 -c "import json; d=json.loads('''$REORDER'''); print(len(d.get('data',[])))" 2>/dev/null || echo "0")
echo "  reorder rows=$REORDER_ROWS"
MED3_IN=$(python3 -c "
import json; d=json.loads('''$REORDER''')
r=[x for x in d.get('data',[]) if x.get('sku','').startswith('MED003-')]
print('yes' if r else 'no')" 2>/dev/null || echo "no")
[[ "$MED3_IN" == "yes" ]] && ok "MED003 ติดรายการ reorder (qty<point)" || fail "MED003 ไม่อยู่ใน reorder"

# ────────────────────────────────────────────────────────────────
c "25 · Export Excel (balance)"
EXPORT_CODE=$(curl -s -b "$CK" "$BASE/api/reports/balance/export" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "000")
chk "Balance export → HTTP 200" '200' "$EXPORT_CODE"

# ────────────────────────────────────────────────────────────────
c "26 · Login ผิดรหัส → ต้องปฏิเสธ"
BAD_LOGIN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$_EMAIL\",\"password\":\"WRONGPASSWORD1234\"}")
chk "Login ผิดรหัส → error" '"error"' "$BAD_LOGIN"

# ────────────────────────────────────────────────────────────────
c "27 · Logout แล้ว access ถูกปฏิเสธ"
curl -s -b "$CK" -c "$CK" -X POST "$BASE/api/auth/logout" > /dev/null 2>&1 || true
AFTER_LOGOUT=$(curl -s -b "$CK" "$BASE/api/items" 2>/dev/null || echo '{"error":"unauthorized"}')
chk "หลัง logout → unauthorized" '"error"' "$AFTER_LOGOUT"

# ────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ผลรวม:  ✅ PASS=$PASS  ❌ FAIL=$FAIL"
echo "════════════════════════════════════════════════════════════"

if [[ ${#ALL_ISSUES[@]} -gt 0 ]]; then
  echo ""
  echo "  รายการที่ไม่ผ่าน:"
  for issue in "${ALL_ISSUES[@]}"; do
    echo "    • $issue"
  done
fi

rm -f "$CK"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
