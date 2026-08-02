#!/usr/bin/env node
/**
 * Copies files that Vite's per-config builds don't handle on their own -
 * currently just manifest.json, which lives at the extension root (not in
 * public/) so it can be edited without digging through build output.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(root, 'dist');
mkdirSync(distDir, { recursive: true });

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
manifest.version = pkg.version;

writeFileSync(path.join(distDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('wrote dist/manifest.json (version', manifest.version, ')');

// Belt-and-suspenders copy of icons in case a build target's publicDir copy
// step was skipped (e.g. a partial `vite build` run during development).
try {
  mkdirSync(path.join(distDir, 'icons'), { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    const name = `icon-${size}.png`;
    copyFileSync(path.join(root, 'public', 'icons', name), path.join(distDir, 'icons', name));
  }
} catch (err) {
  console.warn('icon copy skipped:', err instanceof Error ? err.message : err);
}
