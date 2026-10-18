// Generates the guide pages (one folder per guide) and sitemap.xml from guides.mjs.
// Run: node website/guides-src/build-guides.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { guides } from './guides.mjs';

const site = path.resolve(import.meta.dirname, '..');
const ORIGIN = 'https://vanta-vault-app.vercel.app';
const DOWNLOAD = 'https://github.com/akawazak/valo-project/releases/latest/download/VantaVault-portable.exe';
const today = new Date().toISOString().slice(0, 10);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const bySlug = Object.fromEntries(guides.map(g => [g.slug, g]));
const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>';

function page(g) {
  const url = `${ORIGIN}/${g.slug}/`;
  const ld = [{
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'VantaVault', applicationCategory: 'GameApplication',
    operatingSystem: 'Windows 10, Windows 11', url, description: g.description, isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, downloadUrl: DOWNLOAD,
  }, {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: g.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  }];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#060b0f">
<meta name="color-scheme" content="dark">
<title>${esc(g.title)} | VantaVault</title>
<meta name="description" content="${esc(g.description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/assets/app-icon.png" type="image/png">
<meta property="og:type" content="article">
<meta property="og:site_name" content="VantaVault">
<meta property="og:title" content="${esc(g.title)} | VantaVault">
<meta property="og:description" content="${esc(g.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${ORIGIN}/assets/${g.image}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/guide.css">
${ld.map(x => `<script type="application/ld+json">${JSON.stringify(x)}</script>`).join('\n')}
</head>
<body>
<header class="site-header"><div class="shell site-header-inner">
  <a class="brand" href="/"><img src="/assets/app-icon.png" width="28" height="28" alt=""><span class="wordmark">VANTA<em>VAULT</em></span></a>
  <nav class="nav" aria-label="Guides"><a href="/#app">Try it live</a><a href="/#guides">All guides</a><a href="https://github.com/akawazak/valo-project" target="_blank" rel="noreferrer">GitHub</a></nav>
  <a class="btn btn-solid btn-small download-link" href="${DOWNLOAD}">Download</a>
</div></header>
<main>
<section class="hero shell">
  <a class="crumb" href="/#guides">Guides</a>
  <h1>${esc(g.h1)}</h1>
  <p class="lede">${esc(g.lede)}</p>
  <div class="actions">
    <a class="btn btn-solid download-link" href="${DOWNLOAD}">Download for Windows</a>
    <a class="btn btn-line" href="/#${g.demoTab}">Try it in the live demo</a>
  </div>
  <p class="meta">Free · Open source · Windows 10 and 11</p>
</section>
<figure class="shot shell"><img src="/assets/${g.image}" width="1800" height="1054" alt="${esc(g.imageAlt)}"><figcaption>Demo account. Names and stats are made up.</figcaption></figure>
<section class="points shell" aria-label="Highlights">
${g.points.map(([h, p]) => `  <div><h2>${esc(h)}</h2><p>${esc(p)}</p></div>`).join('\n')}
</section>
<article class="copy shell">
${g.sections.map(sec => `  <section><h2>${esc(sec.h)}</h2>${sec.p ? `<p>${esc(sec.p)}</p>` : ''}${sec.list ? `<ul class="checks">${sec.list.map(li => `<li>${check}<span>${esc(li)}</span></li>`).join('')}</ul>` : ''}</section>`).join('\n')}
  <section class="faq"><h2>Questions</h2><dl>${g.faq.map(([q, a]) => `<div><dt>${esc(q)}</dt><dd>${esc(a)}</dd></div>`).join('')}</dl></section>
</article>
<section class="related shell"><h2>More guides</h2><div class="guide-list">
${g.related.map(slug => bySlug[slug]).map(r => `  <a class="guide-row" href="/${r.slug}/"><b>${esc(r.h1.replace(/\.$/, ''))}</b><span>${esc(r.short)}</span>${arrow}</a>`).join('\n')}
</div></section>
<section class="cta shell"><div><h2>Download VantaVault</h2><p>Free for Windows 10 and 11. Portable, no setup, and it updates itself.</p></div><a class="btn btn-solid download-link" href="${DOWNLOAD}">Download for Windows</a></section>
</main>
<footer class="footer shell">VantaVault isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</footer>
<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};document.querySelectorAll('.download-link').forEach(a=>a.addEventListener('click',()=>window.va('event',{name:'Download',data:{location:'guide-${g.slug}'}})))</script>
<script defer src="/_vercel/insights/script.js"></script>
</body>
</html>
`;
}

for (const g of guides) {
  await fs.mkdir(path.join(site, g.slug), { recursive: true });
  await fs.writeFile(path.join(site, g.slug, 'index.html'), page(g));
}

const img = (loc, title) => `    <image:image>\n      <image:loc>${ORIGIN}/assets/${loc}</image:loc>\n      <image:title>${esc(title)}</image:title>\n    </image:image>`;
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${ORIGIN}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
${img('tab-loadouts.webp', 'VantaVault VALORANT loadout manager')}
${img('tab-store-detail.webp', 'VantaVault VALORANT store checker')}
${img('tab-history.webp', 'VantaVault VALORANT match history')}
  </url>
${guides.map(g => `  <url>
    <loc>${ORIGIN}/${g.slug}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
${img(g.image, g.imageAlt)}
  </url>`).join('\n')}
</urlset>
`;
await fs.writeFile(path.join(site, 'sitemap.xml'), sitemap);
console.log(`Wrote ${guides.length} guides and sitemap.xml`);
