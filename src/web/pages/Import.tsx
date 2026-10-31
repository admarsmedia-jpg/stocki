import { useState, useRef } from "react";
import * as XLSX from "xlsx";

type RowError = { rowNum: number; errors: string[] };
type PreviewRow = Record<string, unknown>;

const TEMPLATE_COLUMNS = [
  "รหัส", "ชื่อ", "บาร์โค้ด", "หน่วย", "หมวด", "คลัง",
  "จำนวนยกมา", "ต้นทุนต่อหน่วย", "จุดสั่งซื้อ", "ใช้ล็อต",
  "Lot No.", "วันผลิต", "วันหมดอายุ", "เลขที่ PO", "โรงงานผู้ผลิต",
];

function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS]);
  XLSX.utils.book_append_sheet(wb, ws, "สินค้า");
  XLSX.writeFile(wb, "stocki-template.xlsx");
}

export default function Import() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [status, setStatus] = useState<"idle" | "preview" | "loading" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus("loading");
    setErrors([]);
    setRows([]);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target!.result, { type: "array", cellDates: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
        setRows(data);
        setStatus("preview");
      } catch {
        setStatus("error");
        setMessage("อ่านไฟล์ไม่ได้ กรุณาใช้ไฟล์ .xlsx");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleImport() {
    if (rows.length === 0) return;
    setStatus("loading");

    const idempotency_key = `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const CHUNK = 500;
    let allErrors: RowError[] = [];

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const res = await fetch("/api/import/opening", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotency_key: `${idempotency_key}-${i}`, rows: chunk }),
      });
      const json = await res.json() as any;
      if (!json.ok && json.errors) {
        allErrors = allErrors.concat(json.errors);
      }
    }

    if (allErrors.length > 0) {
      setErrors(allErrors);
      setStatus("error");
      setMessage(`พบ ${allErrors.length} แถวผิดพลาด`);
    } else {
      setStatus("done");
      setMessage("นำเข้าสำเร็จ");
      setRows([]);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">นำเข้าสต็อกจาก Excel</h1>

      <div className="flex gap-3 mb-6">
        <button
          onClick={downloadTemplate}
          className="px-4 py-2 bg-gray-100 border rounded hover:bg-gray-200"
        >
          ดาวน์โหลดไฟล์แม่แบบ
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          เลือกไฟล์ Excel
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFile} />
      </div>

      {status === "preview" && rows.length > 0 && (
        <div className="mb-4">
          <p className="text-sm text-gray-600 mb-2">พบ {rows.length} แถว — ตรวจสอบแล้วกดยืนยัน</p>
          <div className="overflow-x-auto border rounded max-h-60 overflow-y-auto">
            <table className="text-xs w-full">
              <thead className="bg-gray-50 sticky top-0">
                <tr>{TEMPLATE_COLUMNS.map(c => <th key={c} className="px-2 py-1 text-left">{c}</th>)}</tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((row, i) => (
                  <tr key={i} className="border-t">
                    {TEMPLATE_COLUMNS.map(c => (
                      <td key={c} className="px-2 py-1 whitespace-nowrap">{String(row[c] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 20 && <p className="text-xs text-gray-400 mt-1">แสดง 20 จาก {rows.length} แถว</p>}
          <button
            onClick={handleImport}
            className="mt-3 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            ยืนยันนำเข้า
          </button>
        </div>
      )}

      {status === "loading" && <p className="text-blue-600">กำลังประมวลผล...</p>}
      {status === "done" && <p className="text-green-600 font-semibold">{message}</p>}

      {errors.length > 0 && (
        <div className="mt-4">
          <h2 className="font-semibold text-red-600 mb-2">แถวผิดพลาด ({errors.length} แถว)</h2>
          <ul className="text-sm space-y-1">
            {errors.map(e => (
              <li key={e.rowNum} className="border-l-4 border-red-400 pl-3 py-1">
                <span className="font-medium">แถว {e.rowNum}:</span> {e.errors.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
