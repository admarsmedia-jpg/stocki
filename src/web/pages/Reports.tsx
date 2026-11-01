import { useEffect, useState } from "react";
import { useStore } from "../store";

type ReportType = "balance" | "movements" | "lots" | "expiring" | "reorder";

function fmtQty(v: number | null | undefined) {
  if (v == null) return "-";
  return (v / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function fmtCost(v: number | null | undefined) {
  if (v == null) return "-";
  return (v / 10000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// แปลงแถวข้อมูลก่อนแสดงผลและ export — qty_milli → qty, avg_cost_x4 → avg_cost, total_value_x4 → total_value
function transformRow(row: Record<string, any>, forExport = false) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k.endsWith("_milli")) {
      const label = k.replace(/_milli$/, "");
      out[label] = forExport ? (v as number) / 1000 : v;
    } else if (k.endsWith("_x4")) {
      const label = k.replace(/_x4$/, "");
      out[label] = forExport ? (v as number) / 10000 : v;
    } else {
      out[k] = v;
    }
  }
  return out;
}

const COL_LABELS: Record<string, string> = {
  item_id: "No.",
  sku: "รหัส",
  name_th: "ชื่อสินค้า",
  category: "หมวด",
  warehouse: "คลัง",
  unit: "หน่วย",
  lot_no: "Lot No.",
  expiry_date: "วันหมดอายุ",
  mfg_date: "วันผลิต",
  po_no: "เลขที่ PO",
  manufacturer_name: "โรงงาน",
  qty_on_hand: "คงเหลือ",
  avg_cost: "ต้นทุนเฉลี่ย",
  total_value: "มูลค่ารวม",
  doc_type: "ประเภท",
  doc_date: "วันที่",
  in: "รับเข้า",
  out: "ตัดออก",
  value: "มูลค่า",
  reorder_point: "จุดสั่งซื้อ",
  qty_on_hand_milli: "คงเหลือ",
  avg_cost_x4: "ต้นทุนเฉลี่ย",
  total_value_x4: "มูลค่ารวม",
  in_milli: "รับเข้า",
  out_milli: "ตัดออก",
};

export default function Reports() {
  const { user } = useStore();
  const [active, setActive] = useState<ReportType>("balance");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [expiringDays, setExpiringDays] = useState(30);

  const isOwner = user?.role === "OWNER";

  async function load(type: ReportType, opts?: { days?: number; ds?: string; de?: string }) {
    setActive(type);
    setLoading(true);
    let url = `/api/reports/${type}`;
    const params = new URLSearchParams();
    if (type === "movements") {
      const ds = opts?.ds ?? dateStart;
      const de = opts?.de ?? dateEnd;
      if (ds) params.set("date_start", ds);
      if (de) params.set("date_end", de);
    }
    if (type === "expiring") params.set("days", String(opts?.days ?? expiringDays));
    if ([...params].length) url += "?" + params.toString();
    const res = await fetch(url, { credentials: "include" });
    const json = await res.json() as any;
    setData(json.data ?? []);
    setLoading(false);
  }

  // โหลด balance ทันทีที่เปิดหน้า
  useEffect(() => { load("balance"); }, []);

  async function exportExcel(type: ReportType) {
    let url = `/api/reports/${type === "balance" ? "balance/export" : type === "movements" ? "movements/export" : type + "/export"}`;
    const params = new URLSearchParams();
    if (type === "movements") {
      if (dateStart) params.set("date_from", dateStart);
      if (dateEnd) params.set("date_to", dateEnd);
    }
    if (type === "expiring") params.set("days", String(expiringDays));
    if ([...params].length) url += "?" + params.toString();

    const res = await fetch(url, { credentials: "include" });
    const json = await res.json() as any;
    const rawRows: any[] = json.data ?? [];

    // แปลง milli/x4
    const rows = rawRows.map((r) => transformRow(r, true));

    // สร้าง headers ภาษาไทย จาก columns ที่ API ส่งมา หรือสร้างเอง
    const cols: { key: string; label: string }[] = json.columns ?? Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: COL_LABELS[k] ?? k }));

    const { utils, writeFile } = await import("xlsx");
    const wsData = [
      cols.map((c) => c.label),
      ...rows.map((row) => cols.map((c) => row[c.key] ?? "")),
    ];
    const ws = utils.aoa_to_sheet(wsData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "รายงาน");
    writeFile(wb, `stocki-${type}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  const tabs: { key: ReportType; label: string }[] = [
    { key: "balance", label: "ยอดคงเหลือ" },
    { key: "movements", label: "รับ-จ่าย" },
    { key: "lots", label: "แยกล็อต" },
    { key: "expiring", label: "ใกล้หมดอายุ" },
    { key: "reorder", label: "ต่ำกว่าจุดสั่ง" },
  ];

  const displayData = data.map((r) => transformRow(r));
  const colKeys = displayData.length > 0 ? Object.keys(displayData[0]) : [];

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">รายงาน</h1>

      {/* tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => load(t.key)}
            className={`px-3 py-1 rounded text-sm ${active === t.key ? "bg-blue-600 text-white" : "bg-gray-100"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* filters */}
      {active === "movements" && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="border rounded px-2 py-1 text-sm" />
          <button onClick={() => load("movements")} className="bg-blue-500 text-white px-3 py-1 rounded text-sm">กรอง</button>
        </div>
      )}
      {active === "expiring" && (
        <div className="flex gap-2 mb-3 items-center">
          <span className="text-sm">ภายใน</span>
          {[30, 60, 90].map((d) => (
            <button key={d} onClick={() => { setExpiringDays(d); load("expiring", { days: d }); }}
              className={`px-3 py-1 rounded text-sm ${expiringDays === d ? "bg-orange-500 text-white" : "bg-gray-100"}`}>
              {d} วัน
            </button>
          ))}
        </div>
      )}

      {/* export */}
      {isOwner && (active === "balance" || active === "lots" || active === "movements") && (
        <button onClick={() => exportExcel(active)} className="mb-3 bg-green-600 text-white px-3 py-1 rounded text-sm">
          ส่งออก Excel
        </button>
      )}

      {/* table */}
      {loading ? (
        <p className="text-gray-500 text-sm">กำลังโหลด…</p>
      ) : displayData.length === 0 ? (
        <p className="text-gray-400 text-sm">ไม่มีข้อมูล</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full">
            <thead>
              <tr className="bg-gray-100">
                {colKeys.map((k) => (
                  <th key={k} className="border px-2 py-1 text-left whitespace-nowrap">
                    {COL_LABELS[k] ?? k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayData.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {colKeys.map((k, j) => {
                    const v = row[k];
                    // แสดงค่า qty/cost ที่ถูกต้อง
                    let display: any = v ?? "-";
                    return <td key={j} className="border px-2 py-1 whitespace-nowrap">{String(display)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
