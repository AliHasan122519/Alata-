// Builds ./dist = the mirrored site (./site) + the app shell (PWA manifest, service worker, Android helpers).
//   npm run build
// Env: GITHUB_REPO="owner/repo"  -> enables the Android in-app update check (set by the release workflow).
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { generateSW } from "workbox-build";

const repo = process.env.GITHUB_REPO || process.env.VITE_GITHUB_REPO || "";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("site", "dist", { recursive: true });
if (existsSync("public")) await cp("public", "dist", { recursive: true });
await cp("shell/shell.js", "dist/shell.js");

await writeFile(
  "dist/manifest.webmanifest",
  JSON.stringify(
    {
      name: "متجر العطاء",
      short_name: "متجر العطاء",
      description: "متجر العطاء - تسوق منتجاتك المفضلة بنظام النقاط",
      lang: "ar",
      dir: "rtl",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "portrait",
      theme_color: "#F0EADC",
      background_color: "#F0EADC",
      icons: [
        { src: "/pwa-192x192.png", sizes: "192x192", type: "image/png" },
        { src: "/pwa-512x512.png", sizes: "512x512", type: "image/png" },
        { src: "/pwa-maskable-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    null,
    2,
  ),
);

// Inject the shell into the (otherwise untouched) original index.html
let html = await readFile("dist/index.html", "utf8");
const head = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta name="theme-color" content="#F0EADC">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="متجر العطاء">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/pwa-192x192.png">',
  repo ? `<meta name="github-repo" content="${repo}">` : "",
].filter(Boolean).join("\n    ");
html = html.replace("</head>", `    ${head}\n  </head>`).replace("</body>", '  <script src="/shell.js"></script>\n</body>');
await writeFile("dist/index.html", html);

// Service worker: precache the app, update automatically. Backend calls (Supabase) are never cached.
const { count, size } = await generateSW({
  swDest: "dist/sw.js",
  globDirectory: "dist",
  globPatterns: ["**/*.{html,js,css,png,svg,ico,mp3,webmanifest}"],
  globIgnores: ["sw.js", "workbox-*.js"],
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  navigateFallback: "/index.html",
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
});
console.log(`dist ready: ${count} files precached (${(size / 1024).toFixed(0)} KiB)${repo ? ", updates from " + repo : ""}`);
