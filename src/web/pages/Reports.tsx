import { useState } from "react";
import { useStore } from "../store";

type ReportType = "balance" | "movements" | "lots" | "expiring" | "reorder";

export default function Reports() {
  const { user } = useStore();
  const [active, setActive] = useState<ReportType>("balance");
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [expiringDays, setExpiringDays] = useState(30);

  const isOwner = user?.role === "OWNER";

  async function load(type: ReportType) {
    setActive(type);
    setLoading(true);
    let url = `/api/reports/${type}`;
    if (type === "movements" && dateStart && dateEnd)
      url += `?date_start=${dateStart}&date_end=${dateEnd}`;
    if (type === "expiring") url += `?days=${expiringDays}`;
    const res = await fetch(url, { credentials: "include" });
    const json = await res.json();
    setData(json.data ?? []);
    setLoading(false);
  }

  async function exportExcel(type: ReportType) {
    const res = await fetch(`/api/reports/${type === "balance" ? "balance/export" : type}`, {
      credentials: "include",
    });
    const json = await res.json();
    const { utils, writeFile } = await import("xlsx");
    const ws = utils.json_to_sheet(json.data ?? []);
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
            <button key={d} onClick={() => { setExpiringDays(d); load("expiring"); }}
              className={`px-3 py-1 rounded text-sm ${expiringDays === d ? "bg-orange-500 text-white" : "bg-gray-100"}`}>
              {d} วัน
            </button>
          ))}
        </div>
      )}

      {/* export */}
      {(active === "balance" || active === "lots") && (
        <button onClick={() => exportExcel(active)} className="mb-3 bg-green-600 text-white px-3 py-1 rounded text-sm">
          ส่งออก Excel
        </button>
      )}

      {/* table */}
      {loading ? (
        <p className="text-gray-500 text-sm">กำลังโหลด…</p>
      ) : data.length === 0 ? (
        <p className="text-gray-400 text-sm">ไม่มีข้อมูล</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse w-full">
            <thead>
              <tr className="bg-gray-100">
                {Object.keys(data[0]).map((k) => (
                  <th key={k} className="border px-2 py-1 text-left whitespace-nowrap">{k}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  {Object.values(row).map((v: any, j) => (
                    <td key={j} className="border px-2 py-1 whitespace-nowrap">{v ?? "-"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
