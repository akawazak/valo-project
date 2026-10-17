// VantaVault web demo: the real app components with demo data. Nothing here talks to Riot; every API call is stubbed (see build.mjs).
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../frontend/node_modules/bootstrap/dist/css/bootstrap.min.css';
import '../../frontend/src/app/globals.css';
import AppTopbar from '@/components/AppTopbar';
import Toast from '@/components/Toast';
import ArsenalView from '@/features/arsenal/ArsenalView';
import StorePanels from '@/features/dashboard/StorePanels';
import ProfilePanel, { RoundReview, MatchMapAnalytics } from '@/features/profile/ProfilePanel';
import CareerCard from '@/features/profile/CareerCard';
import CompareView from '@/features/profile/CompareView';
import DuoChemistry from '@/features/profile/DuoChemistry';
import LiveMatchOverlay from '@/features/livematch/LiveMatchOverlay';
import s from '../../frontend/src/features/profile/ProfilePanel.module.css';
import { F, card, art, agentNames, mapNames, matches, rr, summary, presets, context, comparisons, loadout } from './data';
import { detail, reviewMap, agentMeta } from './extra-data';

type Tab = 'store' | 'profile' | 'skins';
type Overlay = null | 'live' | 'review' | 'duo' | 'compare' | 'insights';
const no = () => {};
try { localStorage.setItem('riot_puuid', 'demo-vanta'); } catch { /* storage unavailable */ }
const account = { puuid: 'demo-vanta', gameName: 'Vanta', tagLine: 'DEMO', region: 'eu', accessToken: '', entitlementsToken: '' };

// Website tab -> demo state.
const ROUTES: Record<string, { tab: Tab; overlay: Overlay }> = {
  loadouts: { tab: 'skins', overlay: null },
  store: { tab: 'store', overlay: null },
  history: { tab: 'profile', overlay: null },
  review: { tab: 'profile', overlay: 'review' },
  live: { tab: 'profile', overlay: 'live' },
  duos: { tab: 'profile', overlay: 'duo' },
  insights: { tab: 'profile', overlay: 'insights' },
};

function Loadouts({ onToast }: { onToast: (m: string) => void }) {
  const [saved, setSaved] = useState(() => presets);
  const [selected, setSelected] = useState('default-preset');
  const [game, setGame] = useState(loadout(true));
  const [gameCard, setGameCard] = useState(card);
  const [editing, setEditing] = useState(false);
  const base: any = { uuid: 'default-preset', name: 'Current loadout', loadout: game, identity: { playerCardId: gameCard, playerTitleId: F.title.uuid } };
  const chosen: any = saved.find((p: any) => p.uuid === selected) || base;
  const patch = (fn: (p: any) => any) => { setSaved((list: any[]) => list.map(p => p.uuid === selected ? fn(p) : p)); setEditing(true); };
  const apply = (p: any = chosen) => {
    setGame({ ...p.loadout }); setGameCard(p.identity?.playerCardId || card); setEditing(false); setSelected('default-preset');
    onToast(`Demo: "${p.name}" applied. In the app this goes straight to VALORANT.`);
  };
  return <ArsenalView weapons={F.weapons as any} currentLoadout={chosen.loadout} ownedLevelIDs={context.ownedLevelIDs} ownedChromaIDs={context.ownedChromaIDs} contentTiers={[]}
    onSkinSelect={(weaponId: string, skinId: string, skinLevelId: string, chromaId: string) => patch(p => ({ ...p, loadout: { ...p.loadout, [weaponId]: { skinId, skinLevelId, chromaId } } }))}
    onBuddySelect={no} onSkinReset={no} presets={saved} selectedPreset={chosen} defaultPreset={base}
    onPresetSelect={(p: any) => { setEditing(false); setSelected(p.uuid); }} onPresetApply={apply}
    onPresetDelete={() => onToast('Demo: presets can be deleted in the app.')} onPresetRename={no} onCreateVariant={no} onTogglePreset={no}
    onExportPreset={() => onToast('Demo: presets export as a file in the app.')} onImportPresetClick={no} onNewPreset={() => onToast('Demo: create new presets in the app.')}
    agents={F.agents as any} allAgents={F.agents as any} ownedAgentIds={context.ownedAgentIDs} isEditing={editing} editingPreset={editing ? chosen : null}
    onSave={() => setEditing(false)} onCancel={() => setEditing(false)} onSaveAsNew={no} onApply={() => apply()} onApplyWeapon={async () => true}
    currentCardId={chosen.identity.playerCardId} currentTitleId={F.title.uuid}
    onSelectCard={(id: string) => patch(p => ({ ...p, identity: { ...p.identity, playerCardId: id } }))} onSelectTitle={no}
    currentSprays={[]} onUpdateSprays={no} currentFlexes={[]} currentExpressions={[]}
    onAgentAssignment={(ids: string[]) => patch(p => ({ ...p, agents: ids }))}
    accountName="Vanta#DEMO" accountLevel={undefined} accountRank="Diamond 3" accountRankTier={20} onRefresh={no}
    gameIdentity={{ playerCardId: gameCard, playerTitleId: F.title.uuid }} />;
}

function Dialog({ title, sub, children, onClose, tabs }: { title: string; sub: string; children: React.ReactNode; onClose: () => void; tabs?: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="demo-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className={`${s.careerDialog} ${s.careerDialogSingle} demo-dialog`} role="dialog" aria-label={title}>
      <header className={`${s.careerHeader} ${s.careerHeaderCompact}`}>
        <div><h2>{title}</h2><p>{sub}</p></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>{tabs}<button className="demo-close" aria-label="Close" onClick={onClose}>×</button></div>
      </header>
      <div className={`${s.careerBody} demo-body`}>{children}</div>
    </section>
  </div>;
}

function Review({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'round' | 'map'>('round');
  return <Dialog title="Match review" sub="Ascent · Competitive · Vanta#DEMO · 13–8" onClose={onClose}
    tabs={<nav className={s.matchDetailTabs}>
      <button className={tab === 'round' ? s.matchDetailTabActive : ''} aria-pressed={tab === 'round'} onClick={() => setTab('round')}>Round review</button>
      <button className={tab === 'map' ? s.matchDetailTabActive : ''} aria-pressed={tab === 'map'} onClick={() => setTab('map')}>Map</button>
    </nav>}>
    <div style={{ padding: 20 }}>
      {tab === 'map'
        ? <MatchMapAnalytics detail={detail} kills={detail.kills} map={reviewMap as any} agents={agentMeta} weapons={F.weapons as any} loading={false} error="" />
        : <RoundReview detail={detail} map={reviewMap as any} agents={agentMeta} weapons={F.weapons as any} initialRoundNum={16} />}
    </div>
  </Dialog>;
}

function Demo() {
  const [tab, setTab] = useState<Tab>('store');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [toast, setToast] = useState('');
  useEffect(() => {
    const go = (view: string) => { const r = ROUTES[view]; if (!r) return; setTab(r.tab); setOverlay(r.overlay); };
    const first = new URLSearchParams(location.search).get('view'); if (first) go(first);
    const onMsg = (e: MessageEvent) => { if (e.origin === location.origin && e.data?.type === 'vv-demo') go(String(e.data.view)); };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const close = () => setOverlay(null);
  return <div className="app-container">
    <AppTopbar activeTab={tab} onTabChange={(t: any) => { setTab(t); setOverlay(null); }} activeAccount={account as any} useLocalSso={false} isLocalClientActive isBackendOnline
      onOpenSettings={() => setToast('Demo: settings live in the app.')} onOpenAccounts={() => setToast('Demo account. Sign in with your Riot account in the app.')} playerCardId={card} />
    <div className="app-content-wrapper">
      <main className="app-main-content" data-active-tab={tab}>
        <div hidden={tab !== 'store'}><StorePanels /></div>
        {tab === 'profile' ? <ProfilePanel onRequestedProfileChange={no} autoSyncMatches={false} ownPlayerCardId={card} /> : null}
        {tab === 'skins' ? <Loadouts onToast={setToast} /> : null}
      </main>
    </div>
    {overlay === 'live' ? <div className="demo-overlay demo-live"><button className="demo-close demo-close-fixed" aria-label="Close" onClick={close}>×</button><LiveMatchOverlay /></div> : null}
    {overlay === 'review' ? <Review onClose={close} /> : null}
    {overlay === 'insights' ? <Dialog title="Career insights" sub="Your form, playstyle and trends across your synced matches." onClose={close}>
      <CareerCard puuid="demo-vanta" region="eu" queue="competitive" data={summary} matches={matches} rr={rr} agentNames={agentNames} mapNames={mapNames} {...art} />
    </Dialog> : null}
    {overlay === 'compare' ? <Dialog title="Compare profiles" sub="You and Echo, same queue and act." onClose={close}>
      <CompareView data={comparisons} selfPuuid="demo-vanta" region="eu" queue="competitive" agentNames={agentNames} rankIcons={art.rankIcons} rangeLabel="Current act" />
    </Dialog> : null}
    {overlay === 'duo' ? <DuoChemistry you={{ name: 'Vanta', tag: 'DEMO', cardId: card }} region="eu"
      agents={Object.fromEntries(F.agents.map((a: any) => [a.uuid, { name: a.displayName, icon: a.displayIcon, full: a.fullPortrait }]))}
      mapNames={mapNames} mapVisuals={art.mapVisuals} onClose={close} onViewProfile={close} onCompare={() => setOverlay('compare')} /> : null}
    <Toast message={toast} show={!!toast} onClose={() => setToast('')} />
    <div className="demo-badge">Demo account · made-up data · nothing is sent to Riot</div>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Demo />);
