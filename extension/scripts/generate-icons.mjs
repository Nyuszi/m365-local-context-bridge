/**
 * Resizes branding/icons/icon-1024.png (RGBA, rounded transparent corners)
 * into Chrome-compatible PNG sizes under public/icons. Uses macOS `sips`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const source = path.join(root, 'branding', 'icons', 'icon-1024.png');
const outDir = fileURLToPath(new URL('../public/icons', import.meta.url));
const SIZES = [16, 32, 48, 128];

if (!existsSync(source)) {
  console.error(`Missing icon source: ${source}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const dest = path.join(outDir, `icon-${size}.png`);
  const result = spawnSync(
    'sips',
    ['-s', 'format', 'png', '-z', String(size), String(size), source, '--out', dest],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout || `sips failed for ${size}px`);
    process.exit(result.status ?? 1);
  }
  console.log(`generated ${dest}`);
}
