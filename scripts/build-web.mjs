// Builds ./dist = the mirrored site (./site) + the app shell (PWA manifest, service worker, Android helpers).
//   npm run build
// Env: GITHUB_REPO="owner/repo"  -> enables the Android in-app update check (set by the release workflow).
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { generateSW } from "workbox-build";

const repo = process.env.GITHUB_REPO || process.env.VITE_GITHUB_REPO || "";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("site", "dist", { recursive: true });
if (existsSync("public")) await cp("public", "dist", { recursive: true });

// ---- Make the copy fully independent of the Lovable platform -------------------------------------------------
// (a) media files: /__l5e/assets-v1/<uuid>/<file>  ->  /media/<file>
// (b) dormant "Lovable preview" integration inside the bundle (only active on *.lovableproject.com / inside the Lovable editor)
// (c) share-preview image: served from our own site instead of Lovable's storage
const SITE_URL = (process.env.SITE_URL || "https://alataa-store.netlify.app").replace(/\/$/, "");
await mkdir("dist/media", { recursive: true });
for (const f of (await readdir("dist/assets")).filter((x) => x.endsWith(".js") || x.endsWith(".css"))) {
  const path = `dist/assets/${f}`;
  let t = await readFile(path, "utf8");
  t = t.replace(/\/__l5e\/assets-v1\/[0-9a-f-]{36}\/([A-Za-z0-9._-]+)/g, (_m, name) => `/media/${name}`);
  t = t.split("lovable-preview-auth").join("preview-auth")
       .split("lovableproject-dev.com").join("preview-dev.invalid")
       .split("lovableproject.com").join("preview.invalid")
       .split("gpt-eng.com").join("preview-eng.invalid")
       .split("lovable\\.dev").join("preview-host\\.invalid")
       .split("gptengineer\\.app").join("preview-eng\\.invalid")
       .split("lovable.dev").join("preview-host.invalid")
       .split("lovable.app").join("preview-app.invalid")
       .split("gptengineer.run").join("preview-run.invalid")
       .split("gptengineer.app").join("preview-eng.invalid")
       .replace(/dfbc5eee-52b5-4942-b563-efb6e6996aab/g, "alataa-store");
  await writeFile(path, t);
}
// move the media files out of the platform-specific folder
const mediaRoot = "dist/__l5e/assets-v1";
if (existsSync(mediaRoot)) {
  for (const uuid of await readdir(mediaRoot)) for (const file of await readdir(`${mediaRoot}/${uuid}`)) await cp(`${mediaRoot}/${uuid}/${file}`, `dist/media/${file}`);
  await rm("dist/__l5e", { recursive: true, force: true });
}
await rm("dist/placeholder.svg", { force: true });   // Lovable template leftover, unused

await cp("shell/shell.js", "dist/shell.js");
await cp("shell/refund-all.js", "dist/refund-all.js");
await cp("shell/theme.js", "dist/theme.js");
await cp("shell/hall.js", "dist/hall.js");
await cp("fonts", "dist/fonts", { recursive: true });
const fontCss = await readFile("shell/font.css", "utf8");
const darkCss = await readFile("shell/dark.css", "utf8");
const themeInit = await readFile("shell/theme-init.js", "utf8");

// The site talks to Supabase with a public (anon) key that is already shipped inside its bundle.
// The admin add-on needs the same URL + key, so read them from the mirrored bundle.
const bundleFile = (await readdir("site/assets")).find((f) => /^index-.*\.js$/.test(f));
const bundle = await readFile(`site/assets/${bundleFile}`, "utf8");
const supaUrl = (bundle.match(/https:\/\/([a-z0-9]+)\.supabase\.co/) || [])[0] || "";
const supaRef = supaUrl.replace(/^https:\/\//, "").split(".")[0];
const supaKey = (bundle.match(/eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g) || []).find((jwt) => {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    return payload.role === "anon" && payload.ref === supaRef;
  } catch { return false; }
}) || "";
if (!supaUrl || !supaKey) throw new Error("Could not find the Supabase URL/key in the site bundle");

// Optional: point the app at its OWN database instead of the original site's (config/backend.json: { "url", "key" }).
// Empty = keep the original backend. Only the PUBLIC anon key is accepted (a service_role key is refused).
let backendUrl = supaUrl, backendKey = supaKey;
let override = {};
try { override = JSON.parse(await readFile("config/backend.json", "utf8")); } catch { /* no override */ }
if (override.url || override.key) {
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(String(override.url || "").trim());
  if (!m) throw new Error('config/backend.json: "url" must look like https://<project-ref>.supabase.co');
  let payload;
  try { payload = JSON.parse(Buffer.from(String(override.key).trim().split(".")[1], "base64url").toString()); }
  catch { throw new Error('config/backend.json: "key" is not a valid Supabase key'); }
  if (payload.role !== "anon") throw new Error('config/backend.json: the key must be the PUBLIC "anon" key (found role "' + payload.role + '")');
  if (payload.ref !== m[1]) throw new Error("config/backend.json: the key belongs to a different project than the url");
  backendUrl = override.url.trim(); backendKey = override.key.trim();
  let replaced = 0;
  for (const f of (await readdir("dist/assets")).filter((x) => x.endsWith(".js"))) {
    const path = `dist/assets/${f}`;
    let t = await readFile(path, "utf8");
    if (t.includes(supaUrl) || t.includes(supaKey)) {
      t = t.split(supaUrl).join(backendUrl).split(supaKey).join(backendKey);
      await writeFile(path, t); replaced++;
    }
  }
  if (!replaced) throw new Error("Backend override requested but nothing to replace in the bundle");
  console.log("backend override applied ->", backendUrl);
}

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
html = html.replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, "");
html = html.replace(/(<meta[^>]*(?:property="og:image"|name="twitter:image")[^>]*content=")[^"]*(")/g, `$1${SITE_URL}/og-image.png$2`);
const head = [
  '<link rel="manifest" href="/manifest.webmanifest">',
  '<meta name="theme-color" content="#FBF8F3">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="متجر العطاء">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
  '<link rel="icon" type="image/png" sizes="192x192" href="/pwa-192x192.png">',
  repo ? `<meta name="github-repo" content="${repo}">` : "",
  `<script>${themeInit}</script>`,
  `<style id="alataa-dark">${darkCss}</style>`,
  `<style id="alataa-font">${fontCss}</style>`,
  `<link rel="preload" href="/fonts/Dubai-Bold.woff2" as="font" type="font/woff2" crossorigin>`,
  `<meta name="supabase-url" content="${backendUrl}">`,
  `<meta name="supabase-key" content="${backendKey}">`,
].filter(Boolean).join("\n    ");
html = html.replace("</head>", `    ${head}\n  </head>`).replace("</body>", '  <script src="/shell.js"></script>\n  <script src="/refund-all.js"></script>\n  <script src="/hall.js"></script>\n  <script src="/theme.js"></script>\n</body>');
await writeFile("dist/index.html", html);

// The bundle's CONTENT was changed above (backend, media paths), so give it a name that changes with its content.
// Netlify serves /assets/* as "immutable" for a year: keeping the original file name could make a browser that already
// cached the old bundle keep running it (and keep talking to the old database).
{
  const { createHash } = await import("node:crypto");
  const jsName = (await readdir("dist/assets")).find((f) => /^index-.*\.js$/.test(f));
  const code = await readFile(`dist/assets/${jsName}`);
  const hash = createHash("sha256").update(code).digest("base64url").slice(0, 8);
  const renamed = `index-${hash}.js`;
  if (renamed !== jsName) {
    await cp(`dist/assets/${jsName}`, `dist/assets/${renamed}`);
    await rm(`dist/assets/${jsName}`);
    const before = await readFile("dist/index.html", "utf8");
    if (!before.includes(jsName)) throw new Error("index.html does not reference the bundle by its original name");
    await writeFile("dist/index.html", before.split(jsName).join(renamed));
    for (const f of (await readdir("dist/assets")).filter((x) => x.endsWith(".js") || x.endsWith(".css"))) {
      const p = `dist/assets/${f}`; const t = await readFile(p, "utf8");
      if (t.includes(jsName)) await writeFile(p, t.split(jsName).join(renamed));
    }
    console.log(`bundle renamed ${jsName} -> ${renamed}`);
  }
}

// Service worker: precache the app, update automatically. Backend calls (Supabase) are never cached.
const { count, size } = await generateSW({
  swDest: "dist/sw.js",
  globDirectory: "dist",
  globPatterns: ["**/*.{html,js,css,png,svg,ico,mp3,webmanifest,woff2}"],
  globIgnores: ["sw.js", "workbox-*.js"],
  maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
  navigateFallback: "/index.html",
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: true,
});
console.log(`dist ready: ${count} files precached (${(size / 1024).toFixed(0)} KiB)${repo ? ", updates from " + repo : ""}`);
