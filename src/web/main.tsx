import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function App() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <h1 className="text-2xl font-bold">Stocki</h1>
    </div>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
