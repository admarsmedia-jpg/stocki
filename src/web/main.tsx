import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { useStore } from "./store";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Items from "./pages/Items";
import Import from "./pages/Import";
import Receive from "./pages/Receive";
import Reports from "./pages/Reports";
import Issue from "./pages/Issue";
import DocumentDetail from "./pages/DocumentDetail";

type Page = "items" | "import" | "receive" | "issue" | "reports" | "document";

function App() {
  const { user, setUser } = useStore();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [page, setPage] = useState<Page>("items");
  const [docId, setDocId] = useState<number | null>(null);

  useEffect(() => {
    async function init() {
      const setup = await fetch("/api/setup/status").then((r) => r.json()) as any;
      if (setup.needsSetup) { setNeedsSetup(true); setChecking(false); return; }
      const me = await fetch("/api/auth/me");
      if (me.ok) {
        const data = await me.json() as any;
        setUser({ email: data.email, role: data.role });
      }
      setChecking(false);
    }
    init();
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  if (checking) return <div className="min-h-screen flex items-center justify-center text-gray-400">กำลังโหลด...</div>;
  if (needsSetup) return <Setup onDone={() => { setNeedsSetup(false); }} />;
  if (!user) return <Login onLogin={() => {}} />;

  function nav(p: Page) {
    return () => { setPage(p); setDocId(null); };
  }

  const isOwner = user.role === "OWNER";

  // minimal router via navigate prop
  const navigateFn = (path: string) => {
    if (path.startsWith("/documents/")) {
      setDocId(Number(path.split("/").pop()));
      setPage("document");
    } else {
      setPage("items");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-white border-b border-gray-200 shadow-sm px-6 py-0 flex items-center gap-1 print:hidden" style={{minHeight:"52px"}}>
        <span className="font-extrabold text-lg mr-5" style={{color:"#FF6200",letterSpacing:"-0.5px"}}>Stocki!</span>
        {(["items","receive","issue","reports"] as Page[]).concat(isOwner ? ["import" as Page] : []).map((p) => {
          const labels: Record<Page, string> = { items:"สินค้า", import:"นำเข้า Excel", receive:"รับสินค้า", issue:"ตัดออก", reports:"รายงาน", document:"เอกสาร" };
          if (p === "import" && !isOwner) return null;
          const active = page === p;
          return (
            <button key={p} onClick={nav(p as Page)}
              className="text-sm px-3 h-full flex items-center transition-colors"
              style={{
                height:"52px", fontWeight: active ? 700 : 400,
                color: active ? "#FF6200" : "#4b5563",
                borderBottom: active ? "2px solid #FF6200" : "2px solid transparent",
              }}>
              {labels[p as Page]}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-4">
          <span className="text-xs text-gray-400">{user.email} ({user.role === "OWNER" ? "ผู้ดูแล" : "พนักงาน"})</span>
          <button onClick={handleLogout} className="text-xs text-red-500 hover:text-red-700 font-medium">ออกจากระบบ</button>
        </div>
      </nav>
      <main>
        {page === "items" && <Items />}
        {page === "import" && isOwner && <Import />}
        {page === "receive" && <Receive navigate={navigateFn} />}
        {page === "issue" && <Issue navigate={navigateFn} />}
        {page === "reports" && <Reports />}
        {page === "document" && docId && <DocumentDetail docId={docId} onBack={nav("items")} />}
      </main>
      <footer className="print:hidden border-t border-gray-200 bg-white mt-8 text-xs text-gray-400">
        <div className="py-6 px-6 flex flex-wrap justify-center gap-6 border-b border-gray-100">
          {[
            { href:"https://www.marsmedia.co.th/barcode-101-what-is-barcode/", icon:"🔢", label:"Barcode 101", desc:"บาร์โค้ดคืออะไร?" },
            { href:"https://www.marsmedia.co.th/hardware/", icon:"📷", label:"เครื่องอ่านบาร์โค้ด", desc:"สแกนเนอร์ทุกรุ่น" },
            { href:"https://www.marsmedia.co.th/tsc-te-series-barcode-printer/", icon:"🖨️", label:"เครื่องพิมพ์ความร้อน", desc:"พิมพ์ฉลากบาร์โค้ด" },
            { href:"https://www.marsmedia.co.th/media/", icon:"🏷️", label:"สติกเกอร์ ริบบอน RFID", desc:"วัสดุสิ้นเปลือง" },
          ].map(({href,icon,label,desc}) => (
            <a key={href} href={href} target="_blank" rel="noopener noreferrer"
              className="flex flex-col items-center gap-1 w-28 hover:opacity-70 transition-opacity no-underline text-gray-500">
              <span className="text-2xl">{icon}</span>
              <span className="font-semibold text-gray-700 text-center leading-tight">{label}</span>
              <span className="text-center leading-tight">{desc}</span>
            </a>
          ))}
        </div>
        <div className="py-3 px-6 text-center">
          <span style={{color:"#FF6200",fontWeight:700}}>Stocki!</span> — ระบบสต็อกสินค้าโอเพ่นซอร์ส ฟรีตลอดชีพ
          <span className="mx-2">·</span>
          © 2026 Mars Media. สงวนลิขสิทธิ์.
        </div>
      </footer>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
