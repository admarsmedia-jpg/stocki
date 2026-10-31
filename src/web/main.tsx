import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { useStore } from "./store";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Items from "./pages/Items";

function App() {
  const { user, setUser } = useStore();
  const [checking, setChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

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

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <span className="font-bold text-gray-800">Stocki</span>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{user.email} ({user.role === "OWNER" ? "ผู้ดูแล" : "พนักงาน"})</span>
          <button onClick={handleLogout} className="text-sm text-red-600 hover:underline">ออกจากระบบ</button>
        </div>
      </nav>
      <main>
        <Items />
      </main>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
