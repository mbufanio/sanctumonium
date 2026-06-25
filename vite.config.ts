import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
  },
  server: {
    host: true,
    port: 5173,
  },
});
