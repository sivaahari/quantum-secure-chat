// frontend/vite.config.ts
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In Docker Compose the backend is reachable via the service name, not localhost.
// Set BACKEND_HOST=http://backend:5000 in the container environment to override.
const BACKEND = process.env.BACKEND_HOST ?? "http://localhost:5000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: BACKEND,
        changeOrigin: true,
      },
      "/socket.io": {
        target: BACKEND,
        changeOrigin: true,
        ws: true,
      },
    },
  },
});