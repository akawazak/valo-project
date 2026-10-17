// Builds the VantaVault web demo into website/demo/ from the current frontend source.
// Run from anywhere: node website/demo-src/build.mjs
// Demo data only. Every services/api export is replaced by a local stub; only public art from
// media.valorant-api.com is downloaded at build time (and bundled), never account data.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const here = import.meta.dirname;
const site = path.resolve(here, '..');
const root = path.resolve(site, '..');
const front = path.join(root, 'frontend');
const out = path.join(site, 'demo');
const cache = path.join(here, '.cache', 'media');
const req = createRequire(path.join(front, 'package.json'));
const esbuild = req('esbuild');
await fs.mkdir(cache, { recursive: true });
// ffmpeg converts the bundled art to WebP. Set FFMPEG to its path, or have it on PATH.
const ffmpeg = [process.env.FFMPEG, 'C:/Users/ahais/Documents/Codex/tools/video-tools/bin/ffmpeg.exe'].find(p => p && existsSync(p))
  || (spawnSync('ffmpeg', ['-version'], { windowsHide: true }).status === 0 ? 'ffmpeg' : null);
if (!ffmpeg) console.warn('ffmpeg not found: demo art ships as PNG (slower).');
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, 'media'), { recursive: true });

const json = async (name) => JSON.parse(await fs.readFile(path.join(here, name + '.json'), 'utf8'));
const qa = JSON.parse(await fs.readFile(path.join(front, 'qa-polish-meta.json'), 'utf8'));
const weaponPayload = await json('public-weapons');
const agentsPayload = await json('public-agents');
const spraysPayload = await json('public-sprays');
const tiersPayload = await json('public-tiers');
const contentTiersPayload = await json('public-content-tiers');
const ownCard = await json('account-public-card');
const ownTitle = await json('account-public-title');
const accountPreset = await json('account-preset');

// Keep each weapon to its standard skin plus the preset's pick, trimmed to the levels/chromas used.
const weapons = weaponPayload.data.map(w => {
  const standard = w.skins.find(s => s.displayName.startsWith('Standard ')) || w.skins[0];
  const item = accountPreset.loadout[w.uuid];
  const pick = w.skins.find(s => s.uuid === item?.skinId) || standard;
  return { uuid: w.uuid, displayName: w.displayName, displayIcon: w.displayIcon, category: w.category, shopData: w.shopData, defaultSkinUuid: standard.uuid,
    skins: [standard, ...(pick.uuid !== standard.uuid ? [pick] : [])].map(s => ({ ...s,
      levels: s.levels.slice(0, Math.max(1, s.levels.findIndex(l => l.uuid === item?.skinLevelId) + 1)).map(l => ({ ...l, streamedVideo: null })),
      chromas: s.chromas.filter((c, i) => i === 0 || c.uuid === item?.chromaId).map(c => ({ ...c, streamedVideo: null })) })) };
});

// Bundle the public art the fixture points at, so the demo works offline from our own domain.
let mediaCount = 0;
const mediaMap = new Map();
async function localize(value) {
  if (Array.isArray(value)) return Promise.all(value.map(localize));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await localize(v)])));
  if (typeof value !== 'string' || !/^https:\/\/media\.valorant-api\.com\/.+\.(png|jpg|webp)$/.test(value)) return value;
  if (!mediaMap.has(value)) mediaMap.set(value, (async () => {
    const base = crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);
    const cached = path.join(cache, base + path.extname(value));
    try { await fs.access(cached); } catch {
      const r = await fetch(value); if (!r.ok) throw new Error(`Public asset ${r.status}: ${value}`);
      await fs.writeFile(cached, Buffer.from(await r.arrayBuffer()));
    }
    // WebP keeps transparency and is a fraction of the PNG size; fall back to the original without ffmpeg.
    let filename = base + path.extname(value);
    if (ffmpeg) {
      const webp = path.join(cache, base + '.webp');
      try { await fs.access(webp); } catch {
        spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', cached, '-c:v', 'libwebp', '-quality', '82', webp], { windowsHide: true });
      }
      try { await fs.access(webp); filename = base + '.webp'; await fs.copyFile(webp, path.join(out, 'media', filename)); } catch { await fs.copyFile(cached, path.join(out, 'media', filename)); }
    } else await fs.copyFile(cached, path.join(out, 'media', filename));
    mediaCount++;
    return '/demo/media/' + filename;
  })());
  return mediaMap.get(value);
}
const agentNamesWanted = ['Jett', 'Omen', 'Phoenix', 'Skye', 'Raze'];
const agents = agentsPayload.data.filter(a => agentNamesWanted.includes(a.displayName) || accountPreset.agents.includes(a.uuid))
  .map(a => ({ uuid: a.uuid, displayName: a.displayName, displayIcon: a.displayIcon, fullPortrait: a.fullPortrait, role: a.role, abilities: a.abilities, background: a.background, backgroundGradientColors: a.backgroundGradientColors, isBaseContent: true }));
const cards = [ownCard.data, ...qa.cards.filter(c => c.uuid !== ownCard.data.uuid).slice(0, 2)];
const sprays = spraysPayload.data.filter(s => s.displayIcon).slice(4, 8).map(s => ({ uuid: s.uuid, displayName: s.displayName, displayIcon: s.displayIcon, fullIcon: s.displayIcon }));
const fixture = await localize({ weapons, agents, cards, maps: qa.maps.slice(0, 3), contentTiers: contentTiersPayload.data, tiers: tiersPayload.data.at(-1).tiers, sprays, title: ownTitle.data });
await fs.writeFile(path.join(here, 'fixture.json'), JSON.stringify(fixture));

// Every api.ts export becomes a local stub; the ones the demo screens use return demo data.
const apiText = await fs.readFile(path.join(front, 'src/services/api.ts'), 'utf8');
const exportNames = [...new Set([...apiText.matchAll(/export\s+(?:async\s+)?(?:function|const|class|let)\s+(\w+)/g)].map(m => m[1]))];
const overrides = {
  fetchCachedPublicJson: 'publicJson', getCareerInsights: 'career', getDuoChemistry: 'duo', getDuoPartners: 'duoPartners',
  getProfileOverview: '(async()=>profileOverview)', getProfileSeasonSummary: '(async()=>({summary:profileSummary}))',
  getProfileMatchHistory: '(async()=>({matches,total:30}))', getProfileMatchDetails: '(async(id)=>({...detail,matchId:id}))',
  getProfileSyncStatus: '(async()=>({puuid:"demo-vanta",lastSyncedAt:Date.now(),inFlight:false,totalMatches:30}))',
  getAgentStats: '(async()=>({agents:F.agents.slice(0,3).map((a,i)=>({characterId:a.uuid,matches:40-i*9,wins:26-i*6,winrate:65,kills:640,deaths:420,assists:210,kd:1.52,kda:2.02,headshots:211,hsPct:33,timePlayedMillis:72000000}))}))',
  getMapStats: '(async()=>({maps:F.maps.map(m=>({mapID:m.uuid,matches:20,wins:12,winrate:60}))}))',
  getPlayedQueues: '(async()=>({queues:[{queueID:"competitive",matches:128}]}))', getFrequentTeammates: '(async()=>({teammates:[]}))',
  getRRHistory: '(async()=>({snapshots:rr,source:"rr"}))', getAccountXP: '(async()=>null)', postProfileSync: '(async()=>({started:false}))',
  getLiveMatch: '(async()=>liveMatch)', getLiveLoadouts: '(async()=>liveLoadouts)', refreshLiveMatchRanks: '(async()=>liveMatch)', scanLiveMatchLikelyStacks: '(async()=>liveMatch)',
  getStorefront: '(async()=>storefront)', getWallet: '(async()=>wallet)', getAccolades: '(async()=>accoladeData)',
};
await fs.writeFile(path.join(here, 'api-stub.ts'), `// Generated by build.mjs. Do not edit.
import {accoladeData,profileOverview,profileSummary,liveMatch,liveLoadouts,storefront,wallet,detail} from './extra-data';
import {matches,rr,F,publicJson,career,duo,duoPartners} from './data';
${exportNames.map(n => `export const ${n}:any=${overrides[n] || '(async()=>({}))'};`).join('\n')}
`);

const src = path.join(front, 'src');
await esbuild.build({
  entryPoints: [path.join(here, 'demo.tsx')], outdir: path.join(out, 'dist'), bundle: true, format: 'esm', jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none',
  loader: { '.png': 'file', '.svg': 'file', '.woff2': 'file', '.woff': 'file', '.jpg': 'file' }, nodePaths: [path.join(front, 'node_modules')],
  plugins: [{ name: 'demo-data', setup(build) {
    build.onResolve({ filter: /services\/api$/ }, () => ({ path: path.join(here, 'api-stub.ts') }));
    build.onResolve({ filter: /^@\// }, args => {
      if (args.path === '@/services/api') return { path: path.join(here, 'api-stub.ts') };
      if (args.path === '@/context/DataContext') return { path: path.join(here, 'context-stub.ts') };
      const rel = args.path.slice(2);
      const ext = path.extname(rel) ? '' : ((rel.includes('features/') || rel.includes('components/')) && !rel.endsWith('/reviewStats') && !rel.endsWith('/accoladeCatalog') ? '.tsx' : '.ts');
      return { path: path.join(src, rel) + ext };
    });
    build.onResolve({ filter: /^next\/image$/ }, () => ({ path: path.join(here, 'image-stub.tsx') }));
    build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: path.join(here, 'navigation-stub.ts') }));
    build.onResolve({ filter: /^\/(themes|accolades)\// }, args => ({ path: args.path, external: true }));
  } }],
});
await fs.copyFile(path.join(here, 'demo-ui.css'), path.join(out, 'dist', 'demo-ui.css'));
await fs.writeFile(path.join(out, 'index.html'), `<!doctype html>
<html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>VantaVault demo</title><link rel="stylesheet" href="/demo/dist/demo.css"><link rel="stylesheet" href="/demo/dist/demo-ui.css"></head>
<body><div id="root"></div><script type="module" src="/demo/dist/demo.js"></script></body></html>
`);
// Static app assets the components reference by absolute path.
for (const dir of ['themes', 'accolades']) await fs.cp(path.join(front, 'public', dir), path.join(site, dir), { recursive: true });
await fs.copyFile(path.join(front, 'public', 'brand-mark.svg'), path.join(site, 'brand-mark.svg'));
console.log(`Demo built into website/demo (${mediaCount} art files).`);
