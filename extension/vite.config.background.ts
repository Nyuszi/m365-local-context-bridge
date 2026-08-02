import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const r = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// The MV3 background service worker is bundled as a single, dependency-free
// IIFE so it can be loaded as a classic (non-module) service worker script,
// which avoids any runtime module-resolution/CSP surprises.
export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2022',
    lib: {
      entry: r('./src/background/service-worker.ts'),
      formats: ['iife'],
      name: 'LocalContextBridgeServiceWorker',
      fileName: () => 'service-worker.js',
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
