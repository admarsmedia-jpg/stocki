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
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-6 py-3 flex items-center gap-6 print:hidden">
        <span className="font-bold text-gray-800 mr-4">Stocki</span>
        <button onClick={nav("items")} className={`text-sm ${page === "items" ? "font-bold text-blue-700" : "text-gray-600 hover:text-gray-900"}`}>สินค้า</button>
        {isOwner && <button onClick={nav("import")} className={`text-sm ${page === "import" ? "font-bold text-blue-700" : "text-gray-600 hover:text-gray-900"}`}>นำเข้า Excel</button>}
        <button onClick={nav("receive")} className={`text-sm ${page === "receive" ? "font-bold text-blue-700" : "text-gray-600 hover:text-gray-900"}`}>รับสินค้า</button>
        <button onClick={nav("issue")} className={`text-sm ${page === "issue" ? "font-bold text-blue-700" : "text-gray-600 hover:text-gray-900"}`}>ตัดออก</button>
        <button onClick={nav("reports")} className={`text-sm ${page === "reports" ? "font-bold text-blue-700" : "text-gray-600 hover:text-gray-900"}`}>รายงาน</button>
        <div className="ml-auto flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email} ({user.role === "OWNER" ? "ผู้ดูแล" : "พนักงาน"})</span>
          <button onClick={handleLogout} className="text-sm text-red-600 hover:underline">ออกจากระบบ</button>
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
