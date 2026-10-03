// The home-screen icons (public/pwa/), scaled up from the game's own 32×32
// icon with nearest-neighbour so the pixel art stays crisp. 192 and 512 are
// whole multiples of 32. Drawn on black: iOS fills transparency with black
// anyway, and Android with white, which would look worse.
//
//   node scripts/make-pwa-icons.mjs
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('public/data/graphics/boe-icon.png').toString('base64');
mkdirSync('public/pwa', { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
for (const size of [192, 512]) {
  const dataUrl = await page.evaluate(async ({ src, size }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${src}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 0, 0, size, size);
    return c.toDataURL('image/png');
  }, { src, size });
  writeFileSync(`public/pwa/icon-${size}.png`, Buffer.from(dataUrl.split(',')[1], 'base64'));
}
await browser.close();
