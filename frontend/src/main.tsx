// frontend/src/main.tsx
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// StrictMode removed — it double-invokes effects in dev,
// causing two simultaneous Socket.IO connections which breaks the join flow.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);