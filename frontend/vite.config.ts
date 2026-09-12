import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Express canopy-watch API
      "/api/health": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Exact /api catalog from Express
      "^/api$": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      // Land-check FastAPI (stats, points, search, work-order, check)
      "/api": {
        target: "http://localhost:8765",
        changeOrigin: true,
      },
    },
  },
});
