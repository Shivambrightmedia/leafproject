import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  cacheDir: "node_modules/.vite-wish-tree",
  optimizeDeps: {
    force: true,
  },
});
