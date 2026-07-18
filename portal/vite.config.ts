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
        name: "Proprio",
        short_name: "Proprio",
        description: "Physical therapy portal and guided exercise sessions",
        theme_color: "#1f6b4a",
        background_color: "#e8efe9",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        // Camera workout stays network-first; don't precache MediaPipe wasm blobs.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallbackDenylist: [/^\/workout/],
      },
    }),
  ],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      // Same-origin sessionStorage/auth while iterating on pt-app.
      "/workout": {
        target: "http://127.0.0.1:5175",
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
