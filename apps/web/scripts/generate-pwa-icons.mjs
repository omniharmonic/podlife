#!/usr/bin/env node
/**
 * Generate PWA icon set from the canonical 4000x4000 podlife_logo_alpha.png.
 *
 * Outputs (all into apps/web/public/icons/):
 *   icon-192.png            — alpha, any-purpose
 *   icon-512.png            — alpha, any-purpose
 *   icon-maskable-512.png   — parchment background, logo at 72% safe zone
 *                             so platforms that mask to circles/squircles
 *                             don't clip the wordmark
 *   apple-touch-icon.png    — 180x180, parchment background; iOS doesn't
 *                             mask, but transparent + iOS dark mode looks
 *                             muddy, so we bake the background in
 *
 * Re-run with `pnpm gen:icons` whenever the source logo changes.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PUB = resolve(__dirname, '../public');
const SRC = resolve(PUB, 'podlife_logo_alpha.png');
const OUT_DIR = resolve(PUB, 'icons');

const PARCHMENT = '#FAF7F2';

await mkdir(OUT_DIR, { recursive: true });

async function plainResize(size, name) {
  await sharp(SRC).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(resolve(OUT_DIR, name));
  console.log(`✓ ${name} (${size}x${size}, alpha)`);
}

async function maskable(size, name, safeZonePct = 0.72) {
  // Place the logo on a solid parchment square at safe-zone size so
  // platforms that mask to a circle don't clip the visible content.
  const inner = Math.round(size * safeZonePct);
  const offset = Math.round((size - inner) / 2);
  const logoBuf = await sharp(SRC).resize(inner, inner, { fit: 'contain' }).toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: PARCHMENT,
    },
  })
    .composite([{ input: logoBuf, top: offset, left: offset }])
    .png()
    .toFile(resolve(OUT_DIR, name));
  console.log(`✓ ${name} (${size}x${size}, parchment, ${Math.round(safeZonePct * 100)}% safe zone)`);
}

await plainResize(192, 'icon-192.png');
await plainResize(512, 'icon-512.png');
await maskable(512, 'icon-maskable-512.png', 0.72);
// Apple touch icon: same idea, 180x180, slightly tighter safe zone since
// iOS doesn't mask aggressively.
await maskable(180, 'apple-touch-icon.png', 0.78);
console.log('done.');
