import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const r = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// The content script is bundled as a self-contained IIFE (no imports/exports
// at runtime) so it can be safely injected into third-party pages under a
// strict, no-remote-code, no-eval policy.
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
      entry: r('./src/content/content-script.ts'),
      formats: ['iife'],
      name: 'LocalContextBridgeContentScript',
      fileName: () => 'content-script.js',
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
