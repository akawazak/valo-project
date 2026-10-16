"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAccolades, type AccoladesResponse } from "@/services/api";
import { buildAccoladeTiles, pickActId, recordFor, type AccoladeScope, type AccoladeTile } from "./accoladeCatalog";
import a from "./Accolades.module.css";

interface ActMeta { uuid: string; displayName?: string; endTime?: string }

// One fetch per app session unless the user refreshes; the endpoint is undocumented.
let cached: { at: number; data: AccoladesResponse } | null = null;
const CACHE_MS = 5 * 60 * 1000;

function actCountdown(endTime?: string): string {
    if (!endTime) return "";
    const days = Math.floor((new Date(endTime).getTime() - Date.now()) / 86_400_000);
    if (Number.isNaN(days) || days < 0) return "";
    return days === 0 ? "ends today" : `${days} ${days === 1 ? "day" : "days"} left`;
}

function Hex({ tile, big }: { tile: AccoladeTile; big?: boolean }) {
    return <span className={`${a.hex} ${big ? a.hexBig : ""}`} aria-hidden="true">
        <span className={a.hexBack} />
        <span className={a.hexPlate}><span className={a.hexGlass} /></span>
        <span className={a.hexBadge}><span className={a.hexBadgeIn}><i className={a.glyph} style={{ ["--glyph" as string]: `url("/accolades/${tile.info.key}.png")` }} /></span></span>
    </span>;
}

function ScopeBlock({ label, tile, scope }: { label: string; tile: AccoladeTile; scope: AccoladeScope }) {
    const record = recordFor(tile, scope);
    if (!record || record.count <= 0) return <section className={a.scope}><h4>{label}</h4><div className={`${a.card} ${a.cardNone}`}><b>0</b><small>Not earned yet</small></div></section>;
    const [value, unit] = tile.info.best(record.best);
    return <section className={a.scope}>
        <h4>{label}</h4>
        <div className={a.card}><b>{record.count}</b><small>{record.count === 1 ? "Accolade earned" : "Accolades earned"}</small></div>
        <div className={`${a.card} ${a.cardBest}`}><div><b>{value} <span>{unit}</span></b><small>Personal best</small></div><i className={a.medal} aria-hidden="true" /></div>
    </section>;
}

export default function Accolades({ onClose, currentActId, acts }: { onClose: () => void; currentActId?: string; acts: ActMeta[] }) {
    const [data, setData] = useState<AccoladesResponse | null>(cached?.data ?? null);
    const [updatedAt, setUpdatedAt] = useState<number | null>(cached?.at ?? null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [scope, setScope] = useState<AccoladeScope>("act");
    const [selectedId, setSelectedId] = useState("");

    const load = useCallback(async (force: boolean) => {
        if (!force && cached && Date.now() - cached.at < CACHE_MS) return;
        setLoading(true); setError("");
        try {
            const next = await getAccolades();
            cached = { at: Date.now(), data: next };
            setData(next); setUpdatedAt(cached.at);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(false); }, [load]);

    const actId = data ? pickActId(data, currentActId) : undefined;
    const tiles = useMemo(() => (data ? buildAccoladeTiles(data, actId) : []), [data, actId]);
    const act = acts.find((item) => item.uuid.toLowerCase() === (actId || currentActId || "").toLowerCase());
    const earnedTiles = tiles.filter((tile) => (recordFor(tile, scope)?.count || 0) > 0);
    const total = earnedTiles.reduce((sum, tile) => sum + (recordFor(tile, scope)?.count || 0), 0);
    // Default to the first earned accolade so the detail opens on something you have.
    const selected = tiles.find((tile) => tile.id === selectedId) || earnedTiles[0] || tiles[0];
    const actTitle = [act?.displayName?.replace(/^ACT\b/i, "Act") || "This act", actCountdown(act?.endTime)].filter(Boolean).join(" · ");

    const group = (name: "core" | "performance", split: number) => {
        const list = tiles.filter((tile) => tile.info.group === name);
        const row = (items: AccoladeTile[]) => items.map((tile) => {
            const record = recordFor(tile, scope);
            const earned = (record?.count || 0) > 0;
            return <button key={tile.id} type="button" className={a.tile} data-earned={earned} data-selected={selected?.id === tile.id} aria-pressed={selected?.id === tile.id} onClick={() => setSelectedId(tile.id)} title={tile.info.requirement(tile.threshold)}>
                <Hex tile={tile} />
                <b className={a.count}>{record?.count || 0}</b>
                <small>{tile.info.name}</small>
            </button>;
        });
        return <>
            <h3 className={a.group}>{name === "core" ? "Core" : "Performance"}</h3>
            <div className={a.row}>{row(list.slice(0, split))}</div>
            <div className={`${a.row} ${a.rowOffset}`}>{row(list.slice(split))}</div>
        </>;
    };

    return <div className={a.root}>
        <header className={a.bar}>
            <h2>Accolades</h2>
            <nav aria-label="Accolade period">
                <button type="button" data-active={scope === "act"} aria-pressed={scope === "act"} onClick={() => setScope("act")}>This act</button>
                <button type="button" data-active={scope === "lifetime"} aria-pressed={scope === "lifetime"} onClick={() => setScope("lifetime")}>Lifetime</button>
            </nav>
            <div className={a.tools}>
                {updatedAt ? <small>Synced {new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small> : null}
                <button type="button" onClick={() => void load(true)} disabled={loading} aria-label="Refresh accolades" title="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg></button>
                <button type="button" onClick={onClose} aria-label="Close Accolades">×</button>
            </div>
        </header>
        {!data ? <div className={a.state}>
            {error ? <><strong>Accolades are unavailable right now</strong><p>Open VALORANT, then try again. Riot only shares these while the game client is signed in.</p><button type="button" onClick={() => void load(true)}>Try again</button></> : <><span className={a.spinner} aria-hidden="true" /><p>Loading your accolades…</p></>}
        </div> : <div className={a.page}>
            <section className={a.grid} aria-label="Accolades">
                {error ? <div className={a.warn}>Couldn&apos;t refresh, showing your last sync.</div> : null}
                <div className={a.summary}>
                    <div><strong>{scope === "act" ? actTitle : "Lifetime"}</strong><small>{total} earned in total</small></div>
                    <span className={a.tally}><b>{earnedTiles.length}</b><span>/ {tiles.length}</span><small>Unlocked</small></span>
                </div>
                {group("core", 4)}
                {group("performance", 3)}
            </section>
            {selected ? <aside className={a.detail} data-earned={(selected.act?.count || 0) + (selected.lifetime?.count || 0) > 0} aria-live="polite">
                <div className={a.detailHero}>
                    <Hex tile={selected} big />
                    <div><em>{selected.info.group === "core" ? "Core" : "Performance"}</em><h3>{selected.info.name}</h3><p>{selected.info.requirement(selected.threshold)}</p></div>
                </div>
                <ScopeBlock label="Act" tile={selected} scope="act" />
                <ScopeBlock label="Lifetime" tile={selected} scope="lifetime" />
                <p className={a.foot}>Counts Competitive and Premier matches since patch 13.06.</p>
            </aside> : null}
        </div>}
    </div>;
}
