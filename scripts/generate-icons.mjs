// Generates every icon / splash image from the same "Gift" glyph used in the app header.
//   node scripts/generate-icons.mjs
// Outputs: public/* (PWA + favicon) and assets/* (source images for @capacitor/assets).
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("public", { recursive: true });
mkdirSync("assets", { recursive: true });

const GRAD_A = "hsl(38,92%,55%)";
const GRAD_B = "hsl(20,85%,55%)";
const INK = "hsl(340,40%,14%)";
const HERO = ["hsl(345,75%,45%)", "hsl(20,85%,55%)", "hsl(38,92%,55%)"];

// Lucide "Gift" (24x24 grid)
const gift = (stroke) => `
  <g fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="8" width="18" height="4" rx="1"/>
    <path d="M12 8v13"/>
    <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/>
    <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>
  </g>`;

const gradDef = (id) => `
  <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${GRAD_A}"/><stop offset="1" stop-color="${GRAD_B}"/>
  </linearGradient>`;

/** glyph centred on a size x size canvas, occupying `scale` of the canvas */
const glyph = (size, scale, stroke = INK) => {
  const g = size * scale;
  const off = (size - g) / 2;
  return `<g transform="translate(${off} ${off}) scale(${g / 24})">${gift(stroke)}</g>`;
};

const svg = (size, body, defs = "") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs>${defs}</defs>${body}</svg>`);

const png = async (buf, out, size) => {
  await sharp(buf).resize(size, size).png().toFile(out);
  console.log("wrote", out);
};

// 1) Rounded tile, like the logo in the app header
const tile = (size) =>
  svg(size, `<rect width="${size}" height="${size}" rx="${size * 0.22}" fill="url(#g)"/>${glyph(size, 0.56)}`, gradDef("g"));
// 2) Full-bleed (iOS rounds the corners itself; Android maskable needs a safe zone)
const bleed = (size, scale) => svg(size, `<rect width="${size}" height="${size}" fill="url(#g)"/>${glyph(size, scale)}`, gradDef("g"));

writeFileSync("public/icon.svg", tile(512));
await png(tile(512), "public/pwa-512x512.png", 512);
await png(tile(512), "public/pwa-192x192.png", 192);
await png(bleed(1024, 0.46), "public/pwa-maskable-512x512.png", 512);
await png(bleed(1024, 0.56), "public/apple-touch-icon.png", 180);

// favicon.ico (PNG-in-ICO, 48px)
const fav = await sharp(tile(256)).resize(48, 48).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 48; ico[7] = 48; ico[8] = 0; ico[9] = 0;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(fav.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync("public/favicon.ico", Buffer.concat([ico, fav]));
console.log("wrote public/favicon.ico");

// --- Android launcher / splash sources for @capacitor/assets ---
await png(bleed(1024, 0.56), "assets/icon-only.png", 1024);
await png(svg(1024, glyph(1024, 0.46), ""), "assets/icon-foreground.png", 1024);
await png(svg(1024, `<rect width="1024" height="1024" fill="url(#g)"/>`, gradDef("g")), "assets/icon-background.png", 1024);

const heroDefs = `<linearGradient id="h" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="${HERO[0]}"/><stop offset=".6" stop-color="${HERO[1]}"/><stop offset="1" stop-color="${HERO[2]}"/></linearGradient>${gradDef("g")}`;
const S = 2732;
const splash = svg(
  S,
  `<rect width="${S}" height="${S}" fill="url(#h)"/>
   <g transform="translate(${(S - 640) / 2} ${(S - 640) / 2})">
     <rect width="640" height="640" rx="140" fill="url(#g)"/>${glyph(640, 0.56)}
   </g>`,
  heroDefs,
);
await png(splash, "assets/splash.png", S);
await png(splash, "assets/splash-dark.png", S);
