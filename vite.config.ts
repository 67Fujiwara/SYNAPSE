import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // During development the Worker runs on :8787 (wrangler dev).
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  build: { sourcemap: false },
});
