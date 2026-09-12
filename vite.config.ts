import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Canopy Watch",
        short_name: "CanopyWatch",
        description: "Report a hazardous tree in Halifax in under 30 seconds.",
        theme_color: "#002b49",
        background_color: "#f4f6f8",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }
        ]
      }
    })
  ],
  server: {
    port: 5190,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      },
      "/uploads": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  }
});
