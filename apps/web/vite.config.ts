import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The e2e run points the proxy at its own API with VITE_API_TARGET.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3001';
const port = Number(process.env.VITE_PORT ?? 5173);

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    // Same-origin API in dev so session cookies behave like production.
    proxy: {
      '/api': apiTarget,
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        classic: resolve(import.meta.dirname, 'classic.html'),
      },
    },
  },
});
