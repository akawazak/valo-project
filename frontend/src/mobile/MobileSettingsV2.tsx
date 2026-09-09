"use client";

import { useEffect, useMemo, useState } from "react";
import { clearResourceCache, getResourceHealthSnapshot, type ResourceHealth } from "@/lib/resourceCache";
import { buildAuthDebugSnapshot } from "@/lib/authDebug";
import type { RiotAccount } from "@/lib/types";
import { MobileIcon, MobileSheetLayer } from "./MobileKit";
import type { HomeSectionId, MobilePreferences } from "./mobilePreferences";

const SECTION_LABELS: Record<HomeSectionId, { title: string; detail: string }> = {
  presence: { title: "Live status", detail: "Party, queue and current match" },
  progress: { title: "Progress", detail: "Missions, Battle Pass and account level" },
  store: { title: "Store", detail: "Wallet, bundle and daily offers" },
};

function resourceLabel(url: string) {
  const leaf = url.split("/").filter(Boolean).pop() || "data";
  const labels: Record<string, string> = {
    agents: "Agents",
    buddies: "Gun buddies",
    bundles: "Store bundles",
    competitivetiers: "Rank badges",
    contenttiers: "Item tiers",
    contracts: "Contracts",
    currencies: "Currencies",
    maps: "Maps",
    missions: "Missions",
    playercards: "Player cards",
    playertitles: "Player titles",
    seasons: "Seasons",
    sprays: "Sprays",
    themes: "Weapon themes",
    weapons: "Weapons",
  };
  if (labels[leaf.toLowerCase()]) return labels[leaf.toLowerCase()];
  return leaf.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function MobileSettingsV2({
  open,
  onClose,
  preferences,
  onPreferencesChange,
  backendOnline,
  riotConnected,
  accounts,
  activeAccount,
}: {
  open: boolean;
  onClose: () => void;
  preferences: MobilePreferences;
  onPreferencesChange: (next: MobilePreferences) => void;
  backendOnline: boolean;
  riotConnected: boolean;
  accounts: RiotAccount[];
  activeAccount: RiotAccount | null;
}) {
  const [resources, setResources] = useState<ResourceHealth[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const update = () => setResources(getResourceHealthSnapshot());
    update();
    window.addEventListener("vantavault:data-health", update);
    return () => window.removeEventListener("vantavault:data-health", update);
  }, [open]);

  const summary = useMemo(() => ({
    healthy: resources.filter((item) => item.state === "fresh").length,
    cached: resources.filter((item) => item.state === "stale" || item.source === "cache").length,
    errors: resources.filter((item) => item.state === "error").length,
  }), [resources]);

  if (!open) return null;

  const setHidden = (section: HomeSectionId, hidden: boolean) => {
    const values = new Set(preferences.hiddenHomeSections);
    if (hidden) values.add(section); else values.delete(section);
    onPreferencesChange({ ...preferences, hiddenHomeSections: [...values] });
  };

  const move = (section: HomeSectionId, direction: -1 | 1) => {
    const order = [...preferences.homeOrder];
    const index = order.indexOf(section);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    onPreferencesChange({ ...preferences, homeOrder: order });
  };

  const copyDiagnostics = async () => {
    const resourceLines = resources.map((item) => [
      resourceLabel(item.url),
      item.state,
      item.source,
      item.savedAt ? new Date(item.savedAt).toISOString() : "never",
      item.error || "",
    ].join(" | "));
    const snapshot = [
      buildAuthDebugSnapshot(accounts, activeAccount),
      "",
      "Data health",
      `App service: ${backendOnline ? "connected" : "unavailable"}`,
      `Riot session: ${riotConnected ? "connected" : "renew required"}`,
      ...resourceLines,
    ].join("\n");
    await navigator.clipboard.writeText(snapshot);
    setDiagnosticsCopied(true);
    window.setTimeout(() => setDiagnosticsCopied(false), 2000);
  };

  return (
    <MobileSheetLayer onClose={onClose}>
      <section className="mv2-sheet mv3-settings-sheet" onClick={(event) => event.stopPropagation()}>
        <i />
        <header className="mv2-sheet-heading">
          <span><small>VantaVault for Android</small><h2>Settings</h2><p>Choose what Home prioritizes and inspect loaded data.</p></span>
          <button type="button" onClick={onClose} aria-label="Close settings"><MobileIcon name="close" /></button>
        </header>

        <h3>Home layout</h3>
        <div className="mv3-layout-list">
          {preferences.homeOrder.map((section, index) => {
            const hidden = preferences.hiddenHomeSections.includes(section);
            const required = section === "presence";
            return (
              <article key={section} data-hidden={hidden}>
                <span><strong>{SECTION_LABELS[section].title}</strong><small>{SECTION_LABELS[section].detail}</small></span>
                <nav>
                  <button type="button" onClick={() => move(section, -1)} disabled={index === 0} aria-label={`Move ${SECTION_LABELS[section].title} up`}><MobileIcon name="upload" size={17} /></button>
                  <button type="button" onClick={() => move(section, 1)} disabled={index === preferences.homeOrder.length - 1} aria-label={`Move ${SECTION_LABELS[section].title} down`}><MobileIcon name="download" size={17} /></button>
                  <button type="button" className={hidden ? "off" : "on"} onClick={() => setHidden(section, !hidden)} disabled={required} aria-label={`${hidden ? "Show" : "Hide"} ${SECTION_LABELS[section].title}`}><i /></button>
                </nav>
              </article>
            );
          })}
        </div>

        <h3>Data health</h3>
        <button type="button" className="mv3-health-summary" onClick={() => setDetailsOpen((value) => !value)}>
          <span data-state={backendOnline ? "ready" : "error"}><i /><strong>App service</strong><small>{backendOnline ? "Connected" : "Unavailable"}</small></span>
          <span data-state={riotConnected ? "ready" : "error"}><i /><strong>Riot session</strong><small>{riotConnected ? "Connected" : "Renew required"}</small></span>
          <span data-state={summary.errors ? "error" : summary.cached ? "cached" : "ready"}><i /><strong>Game data</strong><small>{summary.errors ? `${summary.errors} failed` : summary.cached ? `${summary.cached} cached` : `${summary.healthy} current`}</small></span>
          <MobileIcon name="chevron" size={18} />
        </button>
        {detailsOpen ? <div className="mv3-health-details">
          {resources.length ? resources.map((item) => (
            <div key={item.key} data-state={item.state}>
              <span><strong>{resourceLabel(item.url)}</strong><small>{item.error || (item.savedAt ? `Saved ${new Date(item.savedAt).toLocaleString()}` : "Not loaded yet")}</small></span>
              <b>{item.state}</b>
            </div>
          )) : <p>Metadata sources will appear after the first Home load.</p>}
          <button type="button" onClick={() => { clearResourceCache(); setResources([]); }}>Clear artwork cache</button>
        </div> : null}
        <button type="button" className="mv3-copy-diagnostics" onClick={() => void copyDiagnostics()}>
          <MobileIcon name={diagnosticsCopied ? "check" : "download"} size={18} />
          <span><strong>{diagnosticsCopied ? "Diagnostics copied" : "Copy diagnostics"}</strong><small>Sanitized account, connection, and cache state—never tokens or cookies</small></span>
        </button>
        <p className="mv3-settings-note">Unread Riot messages stay visible as a badge on Social. Cached data remains usable when Riot or the artwork service is slow.</p>
      </section>
    </MobileSheetLayer>
  );
}
