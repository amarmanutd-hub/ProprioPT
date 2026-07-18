import { defineConfig } from "vite";

const base = process.env.DEMO_BASE || process.env.WORKOUT_BASE || "/";

export default defineConfig({
  // DEMO_BASE=/demo/ (marketing) · WORKOUT_BASE=/workout/ (portal app)
  base,
  server: {
    host: true,
    https: false,
    port: 5175,
    strictPort: true,
  },
  optimizeDeps: {
    exclude: ["@mediapipe/tasks-vision"],
  },
});
