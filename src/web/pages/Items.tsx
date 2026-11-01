import { useState, useEffect } from "react";
import { useStore } from "../store";

type Item = {
  id: number;
  sku: string;
  name_th: string;
  barcode?: string;
  track_lot: number;
  status: string;
  standard_cost_x4?: number;
  unit_id?: number;
  category_id?: number;
  reorder_point_milli?: number;
};

type Unit = { id: number; code: string; name_th: string };

export default function Items() {
  const user = useStore((s) => s.user);
  const [items, setItems] = useState<Item[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);
  const [showForm, setShowForm] = useState(false);

  async function load(query = "") {
    setLoading(true);
    const res = await fetch(`/api/items?q=${encodeURIComponent(query)}`);
    const data = await res.json() as { items: Item[] };
    setItems(data.items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    fetch("/api/units").then(r => r.json()).then(d => setUnits(d.units ?? [])).catch(() => {});
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load(q);
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">รายการสินค้า</h1>
        {user?.role === "OWNER" && (
          <button onClick={() => { setEditItem(null); setShowForm(true); }} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm">
            + เพิ่มสินค้า
          </button>
        )}
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหาชื่อหรือบาร์โค้ด..."
          className="border rounded px-3 py-2 flex-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button type="submit" className="bg-gray-200 px-4 py-2 rounded hover:bg-gray-300 text-sm">ค้นหา</button>
      </form>

      {loading ? (
        <p className="text-gray-500 text-sm">กำลังโหลด...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="px-3 py-2 border">รหัส</th>
                <th className="px-3 py-2 border">ชื่อสินค้า</th>
                <th className="px-3 py-2 border">บาร์โค้ด</th>
                <th className="px-3 py-2 border">หน่วย</th>
                <th className="px-3 py-2 border">ใช้ล็อต</th>
                {user?.role === "OWNER" && <th className="px-3 py-2 border">ต้นทุน</th>}
                {user?.role === "OWNER" && <th className="px-3 py-2 border">แก้ไข</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const unit = units.find(u => u.id === item.unit_id);
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 border font-mono">{item.sku}</td>
                    <td className="px-3 py-2 border">{item.name_th}</td>
                    <td className="px-3 py-2 border font-mono text-xs">{item.barcode ?? "-"}</td>
                    <td className="px-3 py-2 border text-center">{unit ? unit.name_th : "-"}</td>
                    <td className="px-3 py-2 border text-center">{item.track_lot ? "✓" : "-"}</td>
                    {user?.role === "OWNER" && (
                      <td className="px-3 py-2 border text-right">
                        {item.standard_cost_x4 !== undefined ? (item.standard_cost_x4 / 10000).toFixed(2) : "-"}
                      </td>
                    )}
                    {user?.role === "OWNER" && (
                      <td className="px-3 py-2 border text-center">
                        <button onClick={() => { setEditItem(item); setShowForm(true); }} className="text-blue-600 hover:underline text-xs">แก้ไข</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">ไม่พบสินค้า</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <ItemForm
          item={editItem}
          units={units}
          onSave={() => { setShowForm(false); load(q); }}
          onCancel={() => setShowForm(false)}
        />
      )}
    </div>
  );
}

function ItemForm({ item, units, onSave, onCancel }: { item: Item | null; units: Unit[]; onSave: () => void; onCancel: () => void }) {
  const [sku, setSku] = useState(item?.sku ?? "");
  const [name, setName] = useState(item?.name_th ?? "");
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [trackLot, setTrackLot] = useState(item ? Boolean(item.track_lot) : false);
  const [cost, setCost] = useState(item?.standard_cost_x4 !== undefined ? (item.standard_cost_x4 / 10000).toString() : "0");
  const [unitId, setUnitId] = useState<number>(item?.unit_id ?? (units[0]?.id ?? 1));
  const [reorderPoint, setReorderPoint] = useState(item?.reorder_point_milli !== undefined ? (item.reorder_point_milli / 1000).toString() : "0");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!item && units.length > 0 && unitId !== units[0].id) {
      setUnitId(units[0].id);
    }
  }, [units]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const costVal = parseFloat(cost);
    if (isNaN(costVal) || costVal < 0) { setError("ต้นทุนต้องเป็นตัวเลขที่ไม่ติดลบ"); return; }
    const reorderVal = parseFloat(reorderPoint);
    if (isNaN(reorderVal) || reorderVal < 0) { setError("จุดสั่งซื้อต้องเป็นตัวเลขที่ไม่ติดลบ"); return; }
    const body: Record<string, unknown> = {
      sku,
      name_th: name,
      barcode: barcode || null,
      unit_id: unitId,
      track_lot: trackLot,
      standard_cost_x4: Math.round(costVal * 10000),
      reorder_point_milli: Math.round(reorderVal * 1000),
    };
    const url = item ? `/api/items/${item.id}` : "/api/items";
    const method = item ? "PUT" : "POST";
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as any;
      setError(d.error || "บันทึกไม่สำเร็จ");
      return;
    }
    onSave();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">{item ? "แก้ไขสินค้า" : "เพิ่มสินค้า"}</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">รหัสสินค้า (SKU)</label>
            <input value={sku} onChange={(e) => setSku(e.target.value)} required className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">ชื่อสินค้า</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">บาร์โค้ด</label>
            <input value={barcode} onChange={(e) => setBarcode(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">หน่วยนับ</label>
            <select value={unitId} onChange={(e) => setUnitId(Number(e.target.value))} className="w-full border rounded px-3 py-2" required>
              {units.map(u => <option key={u.id} value={u.id}>{u.name_th} ({u.code})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">ต้นทุนมาตรฐาน (บาท)</label>
            <input type="number" step="0.01" min="0" value={cost} onChange={(e) => setCost(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">จุดสั่งซื้อ</label>
            <input type="number" step="0.001" min="0" value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="track_lot" checked={trackLot} onChange={(e) => setTrackLot(e.target.checked)} />
            <label htmlFor="track_lot" className="text-sm">ใช้ล็อต/วันหมดอายุ</label>
          </div>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-2 pt-2">
            <button type="submit" className="flex-1 bg-blue-600 text-white rounded py-2 hover:bg-blue-700">บันทึก</button>
            <button type="button" onClick={onCancel} className="flex-1 bg-gray-200 rounded py-2 hover:bg-gray-300">ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>
  );
}
