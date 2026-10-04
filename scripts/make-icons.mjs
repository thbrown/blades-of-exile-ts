/**
 * The PWA's icons, from the logo the main menu shows (`data/graphics/icon.png`,
 * the game's own 38×38 icon). Scaled by whole multiples with nearest-neighbour
 * so the pixels stay square, centred on the theme colour; the maskable one is
 * scaled into the middle 80% that every launcher mask leaves visible.
 *
 * Usage: node scripts/make-icons.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SRC = 'public/data/graphics/icon.png';
const BG = '#1a1a1a'; // manifest.webmanifest's background_color
const ICONS = [
  { file: 'public/icons/icon-192.png', size: 192, safe: 1 },
  { file: 'public/icons/icon-512.png', size: 512, safe: 1 },
  { file: 'public/icons/apple-touch-icon.png', size: 180, safe: 1 },
  { file: 'public/icons/maskable-512.png', size: 512, safe: 0.8 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
const src = `data:image/png;base64,${readFileSync(SRC).toString('base64')}`;
for (const { file, size, safe } of ICONS) {
  const b64 = await page.evaluate(async ({ src, size, safe, bg }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const scale = Math.max(1, Math.floor((size * safe) / Math.max(img.width, img.height)));
    const w = img.width * scale, h = img.height * scale;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, Math.floor((size - w) / 2), Math.floor((size - h) / 2), w, h);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { src, size, safe, bg: BG });
  writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log(`${file} ${size}×${size}`);
}
await browser.close();
