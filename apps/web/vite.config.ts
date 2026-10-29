import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Same-origin API in dev so session cookies behave like production.
    proxy: {
      '/api': 'http://127.0.0.1:3001',
    },
  },
});
