import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"

// Platform points Vite here. Root index.html stays untouched.
// Build output matches wrangler assets.directory: ./dist/client
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("../../dist/client", import.meta.url)),
    emptyOutDir: true,
  },
  oxc: {
    jsx: "react-jsx",
  },
  server: {
    port: 5173,
    proxy: {
      "/api/": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
})
