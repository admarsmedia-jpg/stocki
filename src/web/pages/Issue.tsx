import { useState, useRef, useEffect } from "react";

type LotOption = {
  id: number;
  lot_no: string;
  expiry_date: string;
  qty_on_hand_milli: number;
};

type LineItem = {
  item_id: number;
  lot_id: number | null;
  sku: string;
  name_th: string;
  qty_milli: number;
  unit_cost_x4: number;
  lot_no?: string;
  expiry_date?: string;
};

type Item = { id: number; sku: string; name_th: string; barcode: string; track_lot: number };

export default function Issue({ navigate }: { navigate: (path: string) => void }) {
  const barcodeRef = useRef<HTMLInputElement>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [warehouses, setWarehouses] = useState<Array<{ id: number; code: string; name: string }>>([]);
  const [docDate, setDocDate] = useState(new Date().toISOString().slice(0, 10));
  const [refText, setRefText] = useState("");
  const [lines, setLines] = useState<LineItem[]>([]);
  const [pendingItem, setPendingItem] = useState<Item | null>(null);
  const [pendingQty, setPendingQty] = useState("1");
  const [pendingLotId, setPendingLotId] = useState<number | null>(null);
  const [lotOptions, setLotOptions] = useState<LotOption[]>([]);
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
    setThaiWarning(/[฀-๿]/.test(val));
  }

  async function lookupBarcode(barcode: string) {
    if (!barcode.trim() || !warehouseId) return;
    const r = await fetch(`/api/items?q=${encodeURIComponent(barcode)}`).then(r => r.json());
    const item = (r.items ?? []).find((i: Item) => i.barcode === barcode || i.sku === barcode);
    if (!item) { setError(`ไม่พบสินค้า: ${barcode}`); return; }

    setPendingItem(item);
    setBarcodeInput("");
    setError("");

    // โหลดล็อตตาม FEFO
    if (item.track_lot) {
      const lr = await fetch(`/api/lots/suggest?item_id=${item.id}&warehouse_id=${warehouseId}`).then(r => r.json());
      setLotOptions(lr.lots ?? []);
      // เลือกล็อตแรก (FEFO) อัตโนมัติ
      if (lr.lots?.length > 0) setPendingLotId(lr.lots[0].id);
      else setPendingLotId(null);
    } else {
      setLotOptions([]);
      setPendingLotId(null);
    }
  }

  function addLine() {
    if (!pendingItem) return;
    const qty = Math.round(parseFloat(pendingQty) * 1000);
    if (isNaN(qty) || qty <= 0) { setError("จำนวนต้องมากกว่า 0"); return; }
    if (pendingItem.track_lot && pendingLotId === null) { setError("เลือกล็อตก่อน"); return; }

    const selectedLot = lotOptions.find(l => l.id === pendingLotId);

    setLines(prev => [...prev, {
      item_id: pendingItem!.id,
      lot_id: pendingLotId,
      sku: pendingItem!.sku,
      name_th: pendingItem!.name_th,
      qty_milli: qty,
      unit_cost_x4: 0,
      lot_no: selectedLot?.lot_no,
      expiry_date: selectedLot?.expiry_date,
    }]);

    setPendingItem(null);
    setPendingQty("1");
    setPendingLotId(null);
    setLotOptions([]);
    setError("");
    setTimeout(() => barcodeRef.current?.focus(), 50);
  }

  async function save() {
    if (!warehouseId) { setError("เลือกคลังก่อน"); return; }
    if (lines.length === 0) { setError("ไม่มีรายการ"); return; }
    setSaving(true);
    setError("");
    try {
      const key = `iss-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const r = await fetch("/api/documents/issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idempotency_key: key,
          warehouse_id: warehouseId,
          doc_date: docDate,
          ref_text: refText || undefined,
          lines: lines.map(l => ({ item_id: l.item_id, lot_id: l.lot_id, qty_milli: l.qty_milli, unit_cost_x4: 0 })),
        }),
      }).then(r => r.json());
      if (!r.ok) throw new Error(r.error || (Array.isArray(r.errors) ? r.errors.join(", ") : JSON.stringify(r)));
      navigate(`/documents/${r.doc_id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">ตัดสินค้าออกจากคลัง</h1>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium mb-1">คลัง</label>
          <select className="border rounded px-3 py-2 w-full" value={warehouseId ?? ""}
            onChange={e => setWarehouseId(Number(e.target.value))}>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">วันที่เอกสาร</label>
          <input type="date" className="border rounded px-3 py-2 w-full" value={docDate} onChange={e => setDocDate(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1">อ้างอิง</label>
          <input type="text" className="border rounded px-3 py-2 w-full" value={refText} onChange={e => setRefText(e.target.value)} placeholder="เช่น ใบเบิก, ชื่อแผนก" />
        </div>
      </div>

      {/* barcode */}
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
          <button onClick={() => lookupBarcode(barcodeInput)}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">ค้นหา</button>
        </div>
      </div>

      {/* pending item */}
      {pendingItem && (
        <div className="border border-blue-300 rounded p-4 mb-4 bg-blue-50">
          <div className="font-medium mb-2">{pendingItem.sku} — {pendingItem.name_th}</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">จำนวน</label>
              <input type="number" min="0.001" step="0.001" className="border rounded px-3 py-2 w-full"
                value={pendingQty} onChange={e => setPendingQty(e.target.value)} />
            </div>
            {pendingItem.track_lot && (
              <div>
                <label className="block text-sm mb-1">ล็อต (FEFO — หมดก่อนอยู่บนสุด)</label>
                {lotOptions.length === 0 ? (
                  <div className="text-red-600 text-sm">ไม่มียอดในคลัง</div>
                ) : (
                  <select className="border rounded px-3 py-2 w-full"
                    value={pendingLotId ?? ""}
                    onChange={e => setPendingLotId(Number(e.target.value))}>
                    {lotOptions.map(l => (
                      <option key={l.id} value={l.id}>
                        {l.lot_no} — หมด {l.expiry_date} (คงเหลือ {(l.qty_on_hand_milli / 1000).toFixed(3)})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={addLine} className="bg-orange-600 text-white px-4 py-2 rounded hover:bg-orange-700">เพิ่มรายการ</button>
            <button onClick={() => { setPendingItem(null); setError(""); barcodeRef.current?.focus(); }}
              className="bg-gray-400 text-white px-4 py-2 rounded hover:bg-gray-500">ยกเลิก</button>
          </div>
        </div>
      )}

      {error && <div className="text-red-600 bg-red-50 border border-red-300 rounded px-3 py-2 mb-3">{error}</div>}

      {lines.length > 0 && (
        <table className="w-full border-collapse border mb-4 text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-2 py-1 text-left">รหัส</th>
              <th className="border px-2 py-1 text-left">ชื่อ</th>
              <th className="border px-2 py-1 text-left">Lot</th>
              <th className="border px-2 py-1 text-left">หมดอายุ</th>
              <th className="border px-2 py-1 text-right">จำนวน</th>
              <th className="border px-2 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="border px-2 py-1">{l.sku}</td>
                <td className="border px-2 py-1">{l.name_th}</td>
                <td className="border px-2 py-1">{l.lot_no ?? "-"}</td>
                <td className="border px-2 py-1">{l.expiry_date ?? "-"}</td>
                <td className="border px-2 py-1 text-right">{(l.qty_milli / 1000).toFixed(3)}</td>
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
          className="bg-orange-700 text-white px-6 py-2 rounded hover:bg-orange-800 disabled:opacity-50">
          {saving ? "กำลังบันทึก..." : "บันทึกใบตัดออก"}
        </button>
        <button onClick={() => navigate("/")} className="border px-4 py-2 rounded hover:bg-gray-50">ยกเลิก</button>
      </div>
    </div>
  );
}
