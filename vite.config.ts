import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Dev runs two processes: Vite serves the UI on :5173 and proxies /api to the
// Hono server on :3000 (`bun run dev` starts both). Production builds to
// `dist/`, which Hono then serves itself — no proxy involved.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      // Uploaded objects are served by Hono, not by Vite — without this the
      // images inserted into a post would 404 in dev but work in production.
      '/uploads': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
