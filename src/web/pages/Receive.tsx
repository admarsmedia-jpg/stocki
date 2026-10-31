import { useState, useRef, useEffect } from "react";

type LineItem = {
  item_id: number;
  lot_id: number | null;
  sku: string;
  name_th: string;
  qty_milli: number;
  unit_cost_x4: number;
  lot_no?: string;
};

type Item = { id: number; sku: string; name_th: string; barcode: string; track_lot: number };
type Lot = { id: number; lot_no: string; expiry_date: string };

export default function Receive({ navigate }: { navigate: (path: string) => void }) {
  const barcodeRef = useRef<HTMLInputElement>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [warehouses, setWarehouses] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [refText, setRefText] = useState("");
  const [lines, setLines] = useState<LineItem[]>([]);
  const [pendingItem, setPendingItem] = useState<Item | null>(null);
  const [pendingQty, setPendingQty] = useState("1");
  const [pendingCost, setPendingCost] = useState("0");
  const [pendingLotNo, setPendingLotNo] = useState("");
  const [pendingExpiry, setPendingExpiry] = useState("");
  const [pendingMfg, setPendingMfg] = useState("");
  const [pendingPO, setPendingPO] = useState("");
  const [pendingMfgName, setPendingMfgName] = useState("");
  const [thaiWarning, setThaiWarning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/warehouses").then(r => r.json()).then(d => {
      if (d.warehouses?.length) {
        setWarehouses(d.warehouses);
        setWarehouseId(d.warehouses[0].id);
      }
    }).catch(() => {});
    barcodeRef.current?.focus();
  }, []);

  function detectThai(val: string) {
    // ตรวจสอบว่าพิมพ์ภาษาไทย
    setThaiWarning(/[฀-๿]/.test(val));
  }

  async function lookupBarcode(barcode: string) {
    if (!barcode.trim()) return;
    const r = await fetch(`/api/items?search=${encodeURIComponent(barcode)}`).then(r => r.json());
    const item = r.items?.find((i: Item) => i.barcode === barcode || i.sku === barcode);
    if (!item) { setError(`ไม่พบสินค้า: ${barcode}`); return; }
    setPendingItem(item);
    setError("");
    setBarcodeInput("");
  }

  async function addLine() {
    if (!pendingItem) return;
    const qty = Math.round(parseFloat(pendingQty) * 1000);
    const cost = Math.round(parseFloat(pendingCost) * 10000);
    if (isNaN(qty) || qty <= 0) { setError("จำนวนต้องมากกว่า 0"); return; }
    if (isNaN(cost) || cost < 0) { setError("ต้นทุนต้องไม่ติดลบ"); return; }

    let lot_id: number | null = null;
    let lot_no_display: string | undefined;

    if (pendingItem.track_lot) {
      if (!pendingLotNo || !pendingExpiry || !pendingMfg) {
        setError("สินค้านี้ใช้ล็อต — กรุณากรอก Lot No., วันผลิต, วันหมดอายุ");
        return;
      }
      // upsert lot via API and get lot_id
      const r = await fetch("/api/lots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: pendingItem.id,
          lot_no: pendingLotNo,
          mfg_date: pendingMfg,
          expiry_date: pendingExpiry,
          po_no: pendingPO,
          manufacturer_name: pendingMfgName,
        }),
      }).then(r => r.json());
      if (!r.ok) { setError(r.error || "สร้างล็อตไม่สำเร็จ"); return; }
      lot_id = r.lot_id;
      lot_no_display = pendingLotNo;
    }

    setLines(prev => [...prev, {
      item_id: pendingItem!.id,
      lot_id,
      sku: pendingItem!.sku,
      name_th: pendingItem!.name_th,
      qty_milli: qty,
      unit_cost_x4: cost,
      lot_no: lot_no_display,
    }]);

    setPendingItem(null);
    setPendingQty("1");
    setPendingCost("0");
    setPendingLotNo("");
    setPendingExpiry("");
    setPendingMfg("");
    setPendingPO("");
    setPendingMfgName("");
    setError("");
    setTimeout(() => barcodeRef.current?.focus(), 50);
  }

  async function save() {
    if (!warehouseId) { setError("เลือกคลังก่อน"); return; }
    if (lines.length === 0) { setError("ไม่มีรายการ"); return; }
    setSaving(true);
    setError("");
    try {
      const key = `rcv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const r = await fetch("/api/documents/receive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_key: key,
          warehouse_id: warehouseId,
          doc_date: docDate,
          ref_text: refText || undefined,
          lines: lines.map(l => ({ item_id: l.item_id, lot_id: l.lot_id, qty_milli: l.qty_milli, unit_cost_x4: l.unit_cost_x4 })),
        }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || JSON.stringify(r.errors));
      navigate(`/documents/${r.doc_id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">รับสินค้าเข้าคลัง</h1>

      {/* header fields */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium mb-1">คลัง</label>
          <select
            className="border rounded px-3 py-2 w-full"
            value={warehouseId ?? ""}
            onChange={e => setWarehouseId(Number(e.target.value))}
          >
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">วันที่เอกสาร</label>
          <input type="date" className="border rounded px-3 py-2 w-full" value={docDate} onChange={e => setDocDate(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">อ้างอิง (เลขที่ PO หรืออื่นๆ)</label>
          <input type="text" className="border rounded px-3 py-2 w-full" value={refText} onChange={e => setRefText(e.target.value)} placeholder="เช่น PO-2611-001" />
        </div>
      </div>

      {/* barcode scanner */}
      <div className="bg-gray-50 rounded p-4 mb-4">
        <label className="block text-sm font-medium mb-1">สแกนบาร์โค้ด / รหัสสินค้า</label>
        {thaiWarning && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-800 px-3 py-2 rounded mb-2 text-sm">
            ⚠️ แป้นพิมพ์เป็นภาษาไทย — กรุณาสลับเป็นภาษาอังกฤษก่อนสแกน (Shift+Alt หรือ Win+Space)
          </div>
        )}
        <div className="flex gap-2">
          <input
            ref={barcodeRef}
            type="text"
            className="border rounded px-3 py-2 flex-1 font-mono"
            value={barcodeInput}
            onChange={e => { setBarcodeInput(e.target.value); detectThai(e.target.value); }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); lookupBarcode(barcodeInput); } }}
            placeholder="ยิงบาร์โค้ดแล้วกด Enter"
            autoComplete="off"
          />
          <button
            onClick={() => lookupBarcode(barcodeInput)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            ค้นหา
          </button>
        </div>
      </div>

      {/* pending item form */}
      {pendingItem && (
        <div className="border border-blue-300 rounded p-4 mb-4 bg-blue-50">
          <div className="font-medium mb-2">{pendingItem.sku} — {pendingItem.name_th}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">จำนวน</label>
              <input type="number" min="0.001" step="0.001" className="border rounded px-3 py-2 w-full"
                value={pendingQty} onChange={e => setPendingQty(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">ต้นทุนต่อหน่วย (บาท)</label>
              <input type="number" min="0" step="0.01" className="border rounded px-3 py-2 w-full"
                value={pendingCost} onChange={e => setPendingCost(e.target.value)} />
            </div>
            {pendingItem.track_lot && (
              <>
                <div>
                  <label className="block text-sm mb-1">Lot No. *</label>
                  <input type="text" className="border rounded px-3 py-2 w-full" value={pendingLotNo} onChange={e => setPendingLotNo(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm mb-1">เลขที่ PO</label>
                  <input type="text" className="border rounded px-3 py-2 w-full" value={pendingPO} onChange={e => setPendingPO(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm mb-1">วันผลิต *</label>
                  <input type="date" className="border rounded px-3 py-2 w-full" value={pendingMfg} onChange={e => setPendingMfg(e.target.value)} />
                </div>
                <div>
                  <label className="block text-sm mb-1">วันหมดอายุ *</label>
                  <input type="date" className="border rounded px-3 py-2 w-full" value={pendingExpiry} onChange={e => setPendingExpiry(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm mb-1">โรงงานผู้ผลิต</label>
                  <input type="text" className="border rounded px-3 py-2 w-full" value={pendingMfgName} onChange={e => setPendingMfgName(e.target.value)} />
                </div>
              </>
            )}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={addLine} className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">เพิ่มรายการ</button>
            <button onClick={() => { setPendingItem(null); setError(""); barcodeRef.current?.focus(); }}
              className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500">ยกเลิก</button>
          </div>
        </div>
      )}

      {error && <div className="text-red-600 bg-red-50 border border-red-300 rounded px-3 py-2 mb-3">{error}</div>}

      {/* lines table */}
      {lines.length > 0 && (
        <table className="w-full border-collapse border mb-4 text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-2 py-1 text-left">รหัส</th>
              <th className="border px-2 py-1 text-left">ชื่อ</th>
              <th className="border px-2 py-1 text-left">Lot</th>
              <th className="border px-2 py-1 text-right">จำนวน</th>
              <th className="border px-2 py-1 text-right">ต้นทุน/หน่วย</th>
              <th className="border px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="border px-2 py-1">{l.sku}</td>
                <td className="border px-2 py-1">{l.name_th}</td>
                <td className="border px-2 py-1">{l.lot_no ?? "-"}</td>
                <td className="border px-2 py-1 text-right">{(l.qty_milli / 1000).toFixed(3)}</td>
                <td className="border px-2 py-1 text-right">{(l.unit_cost_x4 / 10000).toFixed(4)}</td>
                <td className="border px-2 py-1 text-center">
                  <button onClick={() => setLines(prev => prev.filter((_, j) => j !== i))}
                    className="text-red-500 hover:text-red-700 text-xs">ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex gap-3">
        <button onClick={save} disabled={saving || lines.length === 0}
          className="bg-blue-700 text-white px-6 py-2 rounded hover:bg-blue-800 disabled:opacity-50">
          {saving ? "กำลังบันทึก..." : "บันทึกใบรับ"}
        </button>
        <button onClick={() => navigate("/")} className="border px-4 py-2 rounded hover:bg-gray-50">ยกเลิก</button>
      </div>
    </div>
  );
}
