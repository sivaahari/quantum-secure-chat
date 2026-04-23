// frontend/src/main.tsx
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply saved theme before first render to avoid flash of wrong theme
const savedTheme = (() => { try { return localStorage.getItem("qsc_theme"); } catch { return null; } })();
document.documentElement.classList.toggle("dark", savedTheme !== "light");

// StrictMode removed — it double-invokes effects in dev,
// causing two simultaneous Socket.IO connections which breaks the join flow.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);