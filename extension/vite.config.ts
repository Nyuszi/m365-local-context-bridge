import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const r = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// Builds the two extension "pages": the popup (index.html) and the options
// page (options.html). Emits plain ES modules loaded directly by the pages -
// no remote scripts, no eval, matching the extension's strict CSP.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': r('./src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        popup: r('./index.html'),
        options: r('./options.html'),
      },
    },
  },
  publicDir: 'public',
});
