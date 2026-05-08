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

// iOS Add-to-Home-Screen icons. iOS Safari picks the closest-sized
// `apple-touch-icon` link, so we ship a small set that covers the
// common device classes. Background is baked in (parchment) — iOS
// doesn't mask aggressively, but a transparent PNG looks muddy on
// dark-mode home screens.
//   180 — current iPhone (canonical Apple recommendation)
//   167 — iPad Pro
//   152 — older iPad
//   120 — older iPhone non-Retina HD
const APPLE_SIZES = [180, 167, 152, 120];
for (const sz of APPLE_SIZES) {
  await maskable(sz, `apple-touch-icon-${sz}.png`, 0.78);
}
// Default canonical name — iOS falls back to /apple-touch-icon.png if
// it can't find a sized variant in the link list.
await maskable(180, 'apple-touch-icon.png', 0.78);
// Precomposed alias for very old iOS Safari (≤7) which prefers the
// `-precomposed` suffix to avoid auto-overlay/gloss. Modern iOS doesn't
// need it but the alias is free insurance.
await maskable(180, 'apple-touch-icon-precomposed.png', 0.78);
console.log('done.');
