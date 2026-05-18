import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  base: "./",
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html")
      }
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"]
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});
