import { defineConfig } from 'vitest/config';
import type { ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const target = `http://127.0.0.1:${process.env.OLDGUY_DEV_PORT ?? '4173'}`;

export default defineConfig({
  plugins: [react(), tailwind()],
  base: '/',
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 0, // the server's policy forbids data: addresses
    modulePreload: { polyfill: false },
    sourcemap: false,
    cssCodeSplit: false,
  },
  server: {
    host: '127.0.0.1',
    proxy: Object.fromEntries(
      ['/api', '/chapters'].map((p) => [
        p,
        {
          target,
          changeOrigin: true,
          // the server refuses a foreign Host and a foreign Origin
          configure: (proxy) => proxy.on('proxyReq', (r) => r.removeHeader('origin')),
        } satisfies ProxyOptions,
      ]),
    ),
  },
  test: { environment: 'jsdom', setupFiles: ['src/test/setup.ts'], globals: true, exclude: ['e2e/**', 'node_modules/**'] },
});
