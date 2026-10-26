import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure(proxy) {
          // The local UI and Worker use separate ports. Preserve same-origin protection
          // by rewriting only requests genuinely originating from this local Vite UI.
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.headers.origin === 'http://localhost:5173' || req.headers.origin === 'http://127.0.0.1:5173') {
              proxyReq.setHeader('Origin', 'http://127.0.0.1:8787');
            }
          });
        },
      },
    },
  },
  test: { environment: 'node' },
});
