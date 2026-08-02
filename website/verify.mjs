import { readFile, stat } from "node:fs/promises";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const sitemap = await readFile(new URL("./sitemap.xml", import.meta.url), "utf8");
const manifestText = await readFile(new URL("./site.webmanifest", import.meta.url), "utf8");
const featureRoutes = [
  "valorant-store-checker",
  "valorant-loadout-manager",
  "valorant-match-history",
  "valorant-live-match",
  "privacy-and-security",
];
const required = [
  '<meta name="description"',
  '<meta property="og:title"',
  '<meta property="og:image"',
  '<meta name="twitter:card"',
  'application/ld+json',
  '<link rel="canonical" href="https://vanta-vault-app.vercel.app/">',
  '<link rel="alternate" hreflang="x-default" href="https://vanta-vault-app.vercel.app/">',
  '<link rel="sitemap" type="application/xml" title="Sitemap" href="/sitemap.xml">',
  '<title>VantaVault — Free VALORANT Store & Stats Companion</title>',
  '"@type": "WebSite"',
  '"@type": "SoftwareApplication"',
  '"featureList"',
  'store checker',
  'loadout manager',
  'https://github.com/akawazak/valo-project/releases/latest/download/VantaVault-portable.exe',
];

const missing = required.filter((needle) => !html.includes(needle));
if (missing.length) {
  throw new Error(`Website production metadata is incomplete: ${missing.join(", ")}`);
}

if (!html.includes('/_vercel/insights/script.js') || !html.includes('window.va')) {
  throw new Error('Vercel Web Analytics is not installed in website/index.html.');
}

if (!html.includes('/_vercel/speed-insights/script.js') || !html.includes('window.si')) {
  throw new Error('Vercel Speed Insights is not installed in website/index.html.');
}

if (/lorem ipsum|example\.com|TODO|coming soon/i.test(html)) {
  throw new Error("Website contains prototype placeholder copy.");
}

const schemaBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
if (!schemaBlocks.length) {
  throw new Error("Website has no JSON-LD structured data.");
}
for (const [, json] of schemaBlocks) JSON.parse(json);

if (!sitemap.includes("<lastmod>2026-08-02</lastmod>") || !sitemap.includes("<image:image>")) {
  throw new Error("Sitemap is missing freshness or image discovery metadata.");
}

for (const route of featureRoutes) {
  const page = await readFile(new URL(`./${route}/index.html`, import.meta.url), "utf8");
  const expectedCanonical = `https://vanta-vault-app.vercel.app/${route}`;
  if (!page.includes(`<link rel="canonical" href="${expectedCanonical}">`)) {
    throw new Error(`${route} is missing its canonical URL.`);
  }
  if (!page.includes("application/ld+json") || !page.includes("/_vercel/insights/script.js")) {
    throw new Error(`${route} is missing structured data or analytics.`);
  }
  const pageSchema = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, json] of pageSchema) JSON.parse(json);
  if (!sitemap.includes(`<loc>${expectedCanonical}</loc>`)) {
    throw new Error(`${route} is missing from sitemap.xml.`);
  }
}

if (/data:image\/webp;base64/i.test(html)) {
  throw new Error("Homepage still embeds large WebP screenshots as base64.");
}

for (const asset of [
  "assets/homepage-profile-detail.webp",
  "assets/homepage-loadout-detail.webp",
  "assets/social-preview.png",
]) {
  const details = await stat(new URL(`./${asset}`, import.meta.url));
  if (!details.isFile() || details.size === 0) throw new Error(`${asset} is missing.`);
}

const manifest = JSON.parse(manifestText);
if (!manifest.categories?.includes("games") || manifest.lang !== "en") {
  throw new Error("Web manifest is missing discoverability metadata.");
}

console.log("Website pages, assets, SEO, structured data, sitemap, analytics, and stable download link verified.");
