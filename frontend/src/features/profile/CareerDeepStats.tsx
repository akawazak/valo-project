"use client";

import { useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import { fetchCachedPublicJson, type CareerInsights, type CareerTally } from "@/services/api";
import { useCareerInsights } from "./useCareerInsights";
import s from "./ProfilePanel.module.css";
import i from "./Insights.module.css";

interface WeaponMeta { name: string; icon: string; render: string }

// The base weapon icons are flat white; the default skin's render is the gun in its real colours.
function standardRender(weapon: { defaultSkinUuid?: string; skins?: Array<{ uuid?: string; displayIcon?: string; chromas?: Array<{ fullRender?: string; displayIcon?: string }> }> }) {
    const skin = weapon.skins?.find((item) => item.uuid === weapon.defaultSkinUuid);
    return skin?.chromas?.[0]?.fullRender || skin?.displayIcon || "";
}

let weaponMetaPromise: Promise<Record<string, WeaponMeta>> | null = null;
function loadWeaponMeta() {
    weaponMetaPromise ??= fetchCachedPublicJson<{ data?: Array<{ uuid?: string; displayName?: string; killStreamIcon?: string; displayIcon?: string; defaultSkinUuid?: string; skins?: Array<{ uuid?: string; displayIcon?: string; chromas?: Array<{ fullRender?: string; displayIcon?: string }> }> }> }>("https://valorant-api.com/v1/weapons")
        .then((payload) => Object.fromEntries((payload?.data ?? []).flatMap((weapon) => weapon.uuid
            ? [[weapon.uuid.toLowerCase(), { name: weapon.displayName || "Weapon", icon: weapon.killStreamIcon || weapon.displayIcon || "", render: standardRender(weapon) || weapon.displayIcon || "" }]]
            : [])))
        .catch(() => {
            weaponMetaPromise = null;
            return {};
        });
    return weaponMetaPromise;
}

const DAMAGE_LABELS: Record<string, string> = { ability: "Abilities", spike: "Spike", melee: "Melee", other: "Other" };
// Each buy shows the gun that typifies it: default pistol, cheap shotgun, SMG, rifle.
const BUY_LABELS: Record<string, { name: string; detail: string; weapon: string }> = {
    pistol: { name: "Pistol round", detail: "First round of each half", weapon: "29a0cfab-485b-f5d5-779a-b59f85e204a8" },
    eco: { name: "Eco round", detail: "Team loadout under 1,600", weapon: "42da8ccc-40d5-affc-beec-15aa47b42eda" },
    force: { name: "Force buy", detail: "1,600 – 3,600 loadout", weapon: "462080d1-4035-2937-7c09-27aa2a5c27a7" },
    full: { name: "Full buy", detail: "3,600+ loadout", weapon: "9c82e19d-4575-0200-1a81-3eacf00cf872" },
};
const HOUR_BLOCKS = ["00–04", "04–08", "08–12", "12–16", "16–20", "20–24"];

const pct = (tally: CareerTally | { rounds: number; wins: number }) => {
    const total = "attempts" in tally ? tally.attempts : tally.rounds;
    return total ? Math.round((tally.wins / total) * 100) : null;
};

/** Clutches, weapons, buy-type and session form from the cached matches. */
export default function CareerDeepStats({ puuid, region, queue, queueLabel }: { puuid: string; region: string; queue: string; queueLabel: string }) {
    const { data, error } = useCareerInsights(puuid, region, queue);
    const [weapons, setWeapons] = useState<Record<string, WeaponMeta>>({});
    useEffect(() => {
        let cancelled = false;
        void loadWeaponMeta().then((meta) => { if (!cancelled) setWeapons(meta); });
        return () => { cancelled = true; };
    }, []);

    if (error) return <div className={s.extrasError}>{error}</div>;
    if (!data) return <div className={i.loading} aria-busy="true">
        <header className={i.loadingHead}><strong>Deeper look</strong><small><span className={i.spinner} aria-hidden="true" />Reading your cached matches…</small></header>
        <div className={i.skeletonGrid}>{["Clutch performance", "Weapons by kills", "Buy round win rate", "Session momentum"].map((title) => <div key={title} className={i.skeletonCard}><span>{title}</span><i /><i /><i /><i /></div>)}</div>
    </div>;
    if (!data.matches) return null;

    return <CareerDeepStatsView data={data} weapons={weapons} queueLabel={queueLabel} />;
}

const tone = (value: number | null, even = 50) => value === null ? undefined : value >= even + 3 ? "good" : value < even - 3 ? "bad" : undefined;

function Ring({ value, tone: ringTone, children }: { value: number | null; tone?: string; children?: ReactNode }) {
    const length = 2 * Math.PI * 26;
    return <span className={i.ring} data-tone={ringTone} aria-hidden="true">
        <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="26" /><circle cx="32" cy="32" r="26" strokeDasharray={`${(length * (value ?? 0)) / 100} ${length}`} /></svg>
        {children ? <svg className={i.ringIcon} viewBox="0 0 24 24">{children}</svg> : null}
    </span>;
}

const ICONS = {
    clutch: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2.5" /><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" /></>,
    weapons: <path d="M2.5 9.5h13l1.5-2h4.5v4h-4l-1.5 1.5H12l-1 4.5H7.5l1-4.5h-6z" />,
    buys: <><path d="M4 9h16l-1.6 10.5H5.6z" /><path d="M8.5 9 12 4l3.5 5" /></>,
    sessions: <><path d="M3 17l5.5-5.5 4 4L21 7" /><path d="M15 7h6v6" /></>,
    trophy: <><path d="M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8.5 20h7" /></>,
    streak: <><path d="M5 7l5 5-5 5" /><path d="M12 7l5 5-5 5" /></>,
};
const CardTitle = ({ kind, children }: { kind: keyof typeof ICONS; children: ReactNode }) =>
    <h4 className={i.deepTitle}><svg viewBox="0 0 24 24" aria-hidden="true">{ICONS[kind]}</svg>{children}</h4>;

export function CareerDeepStatsView({ data, weapons = {}, queueLabel }: { data: CareerInsights; weapons?: Record<string, WeaponMeta>; queueLabel: string }) {
    const clutchRate = pct(data.clutches);
    const weaponName = (item: string) => weapons[item]?.name || DAMAGE_LABELS[item] || "Weapon";
    const totalKills = data.weapons.reduce((sum, weapon) => sum + weapon.count, 0);
    const topShare = data.weapons[0] && totalKills ? data.weapons[0].count / totalKills : 1;
    const overall = pct({ attempts: data.sessions.decided, wins: data.sessions.wins });
    const tilt = pct(data.sessions.afterTwoLosses);
    const tiltTone = tilt === null || overall === null ? undefined : tilt < overall - 3 ? "bad" : tilt > overall + 3 ? "good" : undefined;
    const games = data.sessions.byGame.map((tally) => ({ tally, rate: pct(tally) }));
    const known = games.flatMap((game) => game.rate === null ? [] : [game.rate]);
    const low = Math.min(...known, overall ?? 50) - 8, high = Math.max(...known, overall ?? 50) + 8;
    // The plot spans 0–100 both ways; points sit in the middle of each game column.
    const x = (index: number) => 10 + index * 20;
    const y = (value: number) => 100 - ((value - low) / (high - low || 1)) * 100;
    const line = games.flatMap((game, index) => game.rate === null ? [] : [`${x(index)},${y(game.rate)}`]).join(" ");
    const hours = data.sessions.byHour.map((tally, index) => ({ tally, label: HOUR_BLOCKS[index], rate: pct(tally) })).filter((entry) => entry.tally.attempts >= 5 && entry.rate !== null);
    const bestHour = hours.reduce<(typeof hours)[number] | null>((best, entry) => (!best || entry.rate! > best.rate! ? entry : best), null);

    return <div className={i.deepStats}>
        <header className={i.deepHeader}>
            <h3>Deeper look</h3>
            <span>Based on {data.matches.toLocaleString()} matches</span>
            <small>{queueLabel} · all acts</small>
        </header>

        <section className={i.deepCard} data-kind="clutch">
            <CardTitle kind="clutch">Clutch performance</CardTitle>
            {data.clutches.attempts ? <>
                <div className={i.deepLead}>
                    <p><strong>{data.clutches.wins}<span> / {data.clutches.attempts}</span></strong><em>{clutchRate}% won</em></p>
                    <Ring value={clutchRate}>{ICONS.clutch}</Ring>
                </div>
                <ol className={i.deepBars}>
                    {data.clutches.bySize.map((tally, index) => {
                        const value = pct(tally);
                        return <li key={index} title={`1v${index + 1}: ${tally.wins} of ${tally.attempts} won`}>
                            <span>1v{index + 1}</span>
                            <i><b style={{ width: `${value ?? 0}%` }} /></i>
                            <small>{tally.attempts ? `${value}%` : "—"}</small>
                        </li>;
                    })}
                </ol>
                <p className={i.deepFoot}>Rounds where you were your team&apos;s last player alive</p>
            </> : <p className={i.deepEmpty}>No clutch situations in these matches yet.</p>}
        </section>

        <section className={i.deepCard} data-kind="weapons">
            <CardTitle kind="weapons">Weapons by kills</CardTitle>
            {data.weapons.length ? <ol className={i.deepWeapons}>
                {data.weapons.slice(0, 4).map((weapon) => {
                    const share = totalKills ? weapon.count / totalKills : 0;
                    const render = weapons[weapon.item]?.render;
                    return <li key={weapon.item}>
                        <span className={i.deepWeaponArt}>{render ? <Image src={render} alt="" width={120} height={40} unoptimized /> : <em>{DAMAGE_LABELS[weapon.item] ? weaponName(weapon.item) : ""}</em>}</span>
                        <span className={i.deepWeaponText}>
                            <span>{weaponName(weapon.item)}</span>
                            <strong>{weapon.count.toLocaleString()}</strong>
                            <small>{Math.round(share * 100)}%</small>
                            <i><b style={{ width: `${(share / topShare) * 100}%` }} /></i>
                        </span>
                    </li>;
                })}
            </ol> : <p className={i.deepEmpty}>No kills recorded yet.</p>}
            {data.weaponDeaths.length ? <p className={i.deepFoot}>Killed most by <b>{weaponName(data.weaponDeaths[0].item)}</b> · {data.weaponDeaths[0].count.toLocaleString()} deaths</p> : null}
        </section>

        <section className={i.deepCard} data-kind="buys">
            <CardTitle kind="buys">Buy round win rate</CardTitle>
            {data.buys.some((buy) => buy.rounds) ? <div className={i.deepBuys}>
                {data.buys.map((buy) => {
                    const value = pct(buy);
                    const meta = BUY_LABELS[buy.type];
                    const icon = meta ? weapons[meta.weapon]?.render : "";
                    return <article key={buy.type} title={meta?.detail}>
                        <span className={i.deepBuyText}><small>{meta?.name || buy.type}</small><strong data-tone={tone(value)}>{value === null ? "—" : `${value}%`}</strong><em>{buy.wins} of {buy.rounds} won</em></span>
                        <span className={i.deepBuyIcon}>{icon ? <Image src={icon} alt="" width={120} height={40} unoptimized /> : null}</span>
                    </article>;
                })}
            </div> : <p className={i.deepEmpty}>Buy data needs competitive, unrated or swiftplay rounds.</p>}
        </section>

        <section className={i.deepCard} data-kind="sessions">
            <CardTitle kind="sessions">Session momentum</CardTitle>
            {data.sessions.decided ? <>
                <div className={i.deepRings}>
                    <div><Ring value={overall} tone="good">{ICONS.trophy}</Ring><p><strong>{overall}%</strong><small>overall</small></p></div>
                    <div><Ring value={tilt} tone={tiltTone === "bad" ? "bad" : "good"}>{ICONS.streak}</Ring><p><strong data-tone={tiltTone}>{tilt === null ? "—" : `${tilt}%`}</strong><small>after two losses</small></p></div>
                </div>
                <div className={i.deepLine}>
                    <small>Win rate by game number in a session</small>
                    <div className={i.deepPlot}>
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                            {overall !== null ? <line x1="0" x2="100" y1={y(overall)} y2={y(overall)} vectorEffect="non-scaling-stroke" /> : null}
                            <polyline points={line} vectorEffect="non-scaling-stroke" />
                        </svg>
                        {games.map((game, index) => game.rate === null ? null : <span key={index} data-tone={tone(game.rate, overall ?? 50)} style={{ left: `${x(index)}%`, top: `${y(game.rate)}%` }} title={`${game.tally.wins} of ${game.tally.attempts} won`}><b>{game.rate}%</b></span>)}
                    </div>
                    <ol>{games.map((_, index) => <li key={index}>{index === 4 ? "5+" : index + 1}</li>)}</ol>
                </div>
                <p className={i.deepFoot}>{data.sessions.sessions} sessions{bestHour ? <> · best hours <b>{bestHour.label}</b> ({bestHour.rate}%)</> : null}</p>
            </> : <p className={i.deepEmpty}>No decided matches in this filter.</p>}
        </section>
    </div>;
}
