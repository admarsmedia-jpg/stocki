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
        <span className="font-extrabold text-lg mr-5" style={{color:"#FF6200",letterSpacing:"-0.5px"}}>Stocki</span>
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
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
