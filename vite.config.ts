import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and ignores vite's HMR host detection.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    // Pure modules only — tree operations, the diff, word counting. Nothing
    // here touches the DOM or Tauri, so no browser environment is needed.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
