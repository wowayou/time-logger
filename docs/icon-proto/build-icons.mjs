// Single source of truth for the app icon (segmented-τ, variant H1).
// Emits icon.svg (rounded plate, "any") + full-bleed maskable, then rasterizes
// all five PNGs via playwright. Run: node docs/icon-proto/build-icons.mjs
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BG     = '#0d0d14';   // app plate (matches existing icon.svg)
const BRIGHT = '#a99fff';   // main line
const CALM   = '#7a6df0';   // other buckets
const SW = 3;

// H1 geometry on a 32-grid (props [.30,.28,.42], gap 1.1, accent = middle).
// crossbar y=11.5, x 9..23; stem M16 11.5 v8.5 q0 3 3.2 3 (site τ).
const SEGS = [
  { d: 'M9 11.5H12.54',      c: CALM   },  // left bucket
  { d: 'M13.64 11.5H16.94',  c: BRIGHT },  // main (at the T-junction)
  { d: 'M18.04 11.5H23',     c: CALM   },  // right bucket
];
function glyph() {
  const bars = SEGS.map(s =>
    `<path d="${s.d}" stroke="${s.c}" stroke-width="${SW}" stroke-linecap="butt"/>`).join('');
  const ends =
    `<circle cx="9" cy="11.5" r="${SW/2}" fill="${CALM}"/>` +
    `<circle cx="23" cy="11.5" r="${SW/2}" fill="${CALM}"/>`;
  const stem =
    `<path d="M16 11.5v8.5q0 3 3.2 3" fill="none" stroke="${BRIGHT}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return bars + ends + stem;
}
const anySvg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${BG}"/>
  ${glyph()}
</svg>`;
// maskable: full-bleed square bg, glyph recentred (content centre 16,17.25 -> 16,16).
const maskSvg =
`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${BG}"/>
  <g transform="translate(0 -1.25)">${glyph()}</g>
</svg>`;

writeFileSync('icon.svg', anySvg.trim() + '\n');

const JOBS = [
  { svg: anySvg,  size: 192, out: 'icons/icon-192.png' },
  { svg: anySvg,  size: 512, out: 'icons/icon-512.png' },
  { svg: maskSvg, size: 180, out: 'icons/apple-touch-icon.png' },
  { svg: maskSvg, size: 192, out: 'icons/maskable-192.png' },
  { svg: maskSvg, size: 512, out: 'icons/maskable-512.png' },
];

const b = await chromium.launch();
const p = await b.newPage({ deviceScaleFactor: 1 });
for (const j of JOBS) {
  await p.setViewportSize({ width: j.size, height: j.size });
  await p.setContent(
    `<style>*{margin:0;padding:0}html,body{width:${j.size}px;height:${j.size}px}svg{display:block;width:${j.size}px;height:${j.size}px}</style>${j.svg}`
  );
  await p.screenshot({ path: j.out, clip: { x: 0, y: 0, width: j.size, height: j.size }, omitBackground: true });
  console.log('wrote', j.out, j.size);
}
await b.close();
console.log('done');
