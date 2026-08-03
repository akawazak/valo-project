import { readFile, stat } from "node:fs/promises";

const html = await readFile(new URL("./index.html", import.meta.url), "utf8");
const sitemap = await readFile(new URL("./sitemap.xml", import.meta.url), "utf8");
const manifestText = await readFile(new URL("./site.webmanifest", import.meta.url), "utf8");
const required = [
  '<meta name="description"',
  '<meta property="og:title"',
  '<meta property="og:image"',
  '<meta name="twitter:card"',
  'application/ld+json',
  '<link rel="canonical" href="https://vanta-vault-app.vercel.app/">',
  '<link rel="alternate" hreflang="x-default" href="https://vanta-vault-app.vercel.app/">',
  '<link rel="sitemap" type="application/xml" title="Sitemap" href="/sitemap.xml">',
  '<meta name="google-site-verification"',
  '<title>VantaVault — VALORANT Store Checker, Loadouts & Stats</title>',
  '"@type": "WebSite"',
  '"@type": "SoftwareApplication"',
  '"featureList"',
  'store checker',
  'loadout manager',
  'id="download-dialog"',
  'Choose a platform',
  'Android .apk',
  'releases?per_page=30',
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

if (/lorem ipsum|example\.com|TODO/i.test(html)) {
  throw new Error("Website contains prototype placeholder copy.");
}

const releaseLogicStart = html.indexOf("function versionParts");
const releaseLogicEnd = html.indexOf("async function release", releaseLogicStart);
if (releaseLogicStart < 0 || releaseLogicEnd < 0) {
  throw new Error("Release comparison logic is missing.");
}
const releaseLogicSource = html.slice(releaseLogicStart, releaseLogicEnd);
const { compareReleases, newestRelease } = new Function(
  `${releaseLogicSource}; return { compareReleases, newestRelease };`,
)();
const releaseFixtures = [
  { tag_name: "v0.9.9", published_at: "2026-08-03T00:00:00Z", assets: [{ name: "VantaVault-portable.exe" }] },
  { tag_name: "v0.10.0", published_at: "2026-07-01T00:00:00Z", assets: [{ name: "VantaVault-portable.exe" }] },
  { tag_name: "v0.11.0-beta.1", prerelease: true, published_at: "2026-08-04T00:00:00Z", assets: [{ name: "VantaVault.apk" }] },
];
const orderedVersions = [...releaseFixtures].sort(compareReleases).map((release) => release.tag_name);
if (orderedVersions.join(",") !== "v0.11.0-beta.1,v0.10.0,v0.9.9") {
  throw new Error(`Release semantic version ordering is incorrect: ${orderedVersions.join(",")}`);
}
const stableWindows = newestRelease(releaseFixtures, {
  stableOnly: true,
  assetTest: (asset) => asset.name.endsWith(".exe"),
});
if (stableWindows?.tag_name !== "v0.10.0") {
  throw new Error("Release selection did not choose the highest stable Windows version.");
}

const schemaBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
if (!schemaBlocks.length) {
  throw new Error("Website has no JSON-LD structured data.");
}
for (const [, json] of schemaBlocks) JSON.parse(json);

if (!sitemap.includes("<lastmod>2026-08-03</lastmod>") || !sitemap.includes("<image:image>")) {
  throw new Error("Sitemap is missing freshness or image discovery metadata.");
}

if ((sitemap.match(/<loc>/g) || []).length !== 1) {
  throw new Error("The restored single-page website sitemap must contain only the homepage.");
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
