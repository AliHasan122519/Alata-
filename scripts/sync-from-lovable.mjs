// Mirrors the published Lovable site into ./site (an exact copy of the app), minus Lovable's
// "Edit with Lovable" badge and its analytics script.
//
//   node scripts/sync-from-lovable.mjs [https://giving-joy-store.lovable.app]
//
// After you publish a change in Lovable, run this (or the "Sync from Lovable" GitHub workflow):
// the changed files are committed, the web app is redeployed and a new APK is released.
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

const ORIGIN = (process.argv[2] || process.env.SOURCE_URL || "https://giving-joy-store.lovable.app").replace(/\/$/, "");
const OUT = "site";

async function get(path) {
  const res = await fetch(ORIGIN + path, { redirect: "follow" });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function save(path, buf) {
  const file = join(OUT, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, buf);
}

function stripLovable(html) {
  return html
    // badge CSS
    .replace(/<style>(?:(?!<\/style>)[\s\S])*?#lovable-badge(?:(?!<\/style>)[\s\S])*?<\/style>\s*/g, "")
    // badge element
    .replace(/<aside[^>]*id="lovable-badge"[\s\S]*?<\/aside>\s*/g, "")
    // badge behaviour script (inline, mentions lovable-badge)
    .replace(/<script(?![^>]*\ssrc=)[^>]*>(?:(?!<\/script>)[\s\S])*?lovable-badge(?:(?!<\/script>)[\s\S])*?<\/script>\s*/g, "")
    // Lovable analytics / event script
    .replace(/<script[^>]*src="\/__l5e\/[^"]*"[^>]*><\/script>\s*/g, "");
}

const html = stripLovable((await get("/")).toString("utf8"));
if (/lovable-badge|__l5e\/events/i.test(html)) throw new Error("Could not fully remove the Lovable badge from index.html");

// Collect every local file the app references (html -> js/css -> media)
const refRe = /\/(?:assets|__l5e\/assets-v1)\/[A-Za-z0-9_@.\-\/]+\.[A-Za-z0-9]+/g;
const queue = [...new Set(html.match(refRe) || [])];
const seen = new Map();
while (queue.length) {
  const p = queue.pop();
  if (seen.has(p)) continue;
  const buf = await get(p);
  seen.set(p, buf);
  if (/\.(js|css)$/.test(p)) {
    for (const r of buf.toString("utf8").match(refRe) || []) if (!seen.has(r)) queue.push(r);
  }
}
for (const extra of ["/favicon.ico", "/robots.txt", "/placeholder.svg"]) {
  try { seen.set(extra, await get(extra)); } catch { /* optional */ }
}

// Replace the previous mirror atomically-ish
await rm(OUT, { recursive: true, force: true });
await save("index.html", Buffer.from(html, "utf8"));
for (const [p, buf] of seen) await save(p, buf);

const files = [];
(async function walk(d) {
  for (const e of await readdir(d, { withFileTypes: true })) {
    const f = join(d, e.name);
    e.isDirectory() ? await walk(f) : files.push(f);
  }
})(OUT).then(() => console.log(`Mirrored ${ORIGIN}: ${files.length} files into ./${OUT}`));
