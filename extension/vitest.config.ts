import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const r = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': r('./src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [r('./test/setup.ts')],
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.tsx', 'src/**/main.ts'],
    },
  },
});
