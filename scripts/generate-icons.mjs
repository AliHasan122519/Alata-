// Generates every icon / splash image from the app logo (assets/logo-source.webp).
//   npm run icons
// Outputs: public/* (PWA + favicon) and assets/* (source images for @capacitor/assets).
// The logo is cut out along its gold ring, so anything outside the circle in the source
// image (paper background, corner watermark) never ends up in an icon.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("public", { recursive: true });
mkdirSync("assets", { recursive: true });

const SRC = "assets/logo-source.webp";
const CREAM = { r: 240, g: 234, b: 220 }; // matches the logo's paper background
const CX = 511.5, CY = 511.5, R = 404; // gold ring of the 1024px source

// Circular cut-out of the logo (transparent outside the ring)
const D = Math.round(R * 2);
const mask = Buffer.from(`<svg width="${D}" height="${D}"><circle cx="${D / 2}" cy="${D / 2}" r="${D / 2}" fill="#fff"/></svg>`);
const cutout = await sharp(SRC)
  .extract({ left: Math.round(CX - R), top: Math.round(CY - R), width: D, height: D })
  .ensureAlpha()
  .composite([{ input: mask, blend: "dest-in" }])
  .png()
  .toBuffer();

/** logo circle taking `scale` of a size x size canvas, over `bg` (or transparent) */
async function compose(size, scale, bg, out) {
  const d = Math.round(size * scale);
  const logo = await sharp(cutout).resize(d, d).toBuffer();
  const canvas = sharp({
    create: { width: size, height: size, channels: 4, background: bg ?? { r: 0, g: 0, b: 0, alpha: 0 } },
  });
  const left = Math.round((size - d) / 2);
  const buf = await canvas.composite([{ input: logo, left, top: left }]).png().toBuffer();
  if (out) {
    writeFileSync(out, buf);
    console.log("wrote", out);
  }
  return buf;
}
const flat = (c) => ({ ...c, alpha: 1 });

// --- Web / PWA ---
await compose(512, 0.9, flat(CREAM), "public/pwa-512x512.png");
await compose(192, 0.9, flat(CREAM), "public/pwa-192x192.png");
await compose(512, 0.7, flat(CREAM), "public/pwa-maskable-512x512.png"); // keeps the ring inside the 80% safe zone
await compose(180, 0.86, flat(CREAM), "public/apple-touch-icon.png");

// favicon.ico (PNG-in-ICO, 48px)
const fav = await sharp(await compose(256, 0.98, null)).resize(48, 48).png().toBuffer();
const ico = Buffer.alloc(22);
ico.writeUInt16LE(0, 0); ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
ico[6] = 48; ico[7] = 48;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(fav.length, 14); ico.writeUInt32LE(22, 18);
writeFileSync("public/favicon.ico", Buffer.concat([ico, fav]));
console.log("wrote public/favicon.ico");

// --- link-preview image (WhatsApp / social shares): 1200x630, logo centred on the paper colour
{
  const logo = await sharp(cutout).resize(520, 520).toBuffer();
  const og = await sharp({ create: { width: 1200, height: 630, channels: 4, background: flat(CREAM) } })
    .composite([{ input: logo, left: 340, top: 55 }]).png().toBuffer();
  writeFileSync("public/og-image.png", og);
  console.log("wrote public/og-image.png");
}

// --- Android launcher / splash sources for @capacitor/assets ---
await compose(1024, 0.86, flat(CREAM), "assets/icon-only.png");
await compose(1024, 0.62, null, "assets/icon-foreground.png"); // adaptive icon: inside the 66% safe zone
writeFileSync(
  "assets/icon-background.png",
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: CREAM } }).png().toBuffer(),
);
console.log("wrote assets/icon-background.png");
await compose(2732, 0.34, flat(CREAM), "assets/splash.png");
await compose(2732, 0.34, flat(CREAM), "assets/splash-dark.png");
