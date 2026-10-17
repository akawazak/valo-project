"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { getDuoChemistry, getDuoPartners, type DuoChemistry as DuoData, type ProfileTeammateStat } from "@/services/api";
import { PLAYER_PALETTES, usePlayerColours } from "./playerColours";
import d from "./DuoChemistry.module.css";
import ShareButton from "@/components/ShareButton";
import { drawDuoShare } from "./shareCards";

const CARD = (id: string | undefined) => id ? `https://media.valorant-api.com/playercards/${id}/smallart.png` : undefined;
const pct = (part: number, whole: number) => whole ? Math.round((part / whole) * 100) : 0;
const url = (src?: string) => src ? `url("${src}")` : undefined;
const MIN_PAIR_GAMES = 3;
const TIMES = ["", "", "twice", "three times", "four times", "five times"];

type Player = { name: string; tag?: string; cardId?: string };
type AgentInfo = { name: string; icon: string; full?: string };
type Duel = { label: string; hint: string; you: number; them: number; youOf?: string; themOf?: string };

function ago(millis: number) {
    const days = Math.floor((Date.now() - millis) / 86_400_000);
    if (days < 1) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return `${days}d ago`;
    return `${Math.floor(days / 30)}mo ago`;
}

/** Each player's most played agent in these games, from the agent pairs. */
function topAgents(pairings: DuoData["pairings"]) {
    const count = (key: "you" | "partner") => {
        const totals = new Map<string, number>();
        pairings.forEach((pair) => totals.set(pair[key], (totals.get(pair[key]) || 0) + pair.games));
        return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    };
    return { you: count("you"), them: count("partner") };
}

/** The map you two have played most in your recent games together. */
function topMap(recent: DuoData["recent"]) {
    const totals = new Map<string, number>();
    recent.forEach((game) => totals.set(game.mapId.toLowerCase(), (totals.get(game.mapId.toLowerCase()) || 0) + 1));
    return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** One plain sentence saying who backs who up, so the numbers below have a point. */
function verdict(data: DuoData, name: string) {
    const you = data.youTradedThem.count;
    const them = data.theyTradedYou.count;
    if (!you && !them) return { lead: "", text: "No trades between you yet." };
    if (you === them) return { lead: "", text: "You cover each other about equally." };
    const [lead, high, low] = you > them ? ["you", you, them] as const : ["them", them, you] as const;
    const who = lead === "you" ? "You" : name;
    const other = lead === "you" ? "them" : "you";
    const back = lead === "you" ? "they cover you" : "you cover them";
    if (!low) return { lead, who, text: ` covered ${other} ${high} ${high === 1 ? "time" : "times"}; ${back.replace("cover", "haven't covered")} yet.` };
    const ratio = Math.round(high / low);
    return { lead, who, text: ratio >= 2 ? ` cover${lead === "you" ? "" : "s"} ${other} ${TIMES[ratio] || `${ratio} times`} as often as ${back}.` : ` cover${lead === "you" ? "" : "s"} ${other} more often than ${back}.` };
}

function subline(data: DuoData, name: string) {
    const yours = data.theirFirstDeathsCovered;
    const theirs = data.yourFirstDeathsCovered;
    if (!yours.count && !theirs.count && (yours.eligible || theirs.eligible)) return "Neither of you has traded a first death yet, the easiest round to win back.";
    if (data.theyAssistedYou !== data.youAssistedThem) return data.theyAssistedYou > data.youAssistedThem ? `${name} sets up more of your kills than you do of theirs.` : `You set up more of ${name}'s kills than they do of yours.`;
    return "Trades count when the killer dies within 5 seconds, the same rule Insights uses.";
}

/** Head to head: your number on the left, theirs on the right, a split bar between, only the leader coloured. */
function HeadToHead({ rows, you, them }: { rows: Duel[]; you: Player; them: Player }) {
    return <div className={d.duels}>
        <div className={d.heads}>
            <span data-side="you"><i style={{ backgroundImage: url(CARD(you.cardId)) }} />You</span>
            <span data-side="them">{them.name}<i style={{ backgroundImage: url(CARD(them.cardId)) }} /></span>
        </div>
        {rows.map((row) => {
            const lead = row.you === row.them ? "" : row.you > row.them ? "you" : "them";
            const share = row.you + row.them > 0 ? (row.you / (row.you + row.them)) * 100 : 50;
            return <div key={row.label} className={d.duel} title={row.hint}>
                <span className={d.n} data-side="you" data-lead={lead === "you" || undefined}>{row.you}{row.youOf ? <small>{row.youOf}</small> : null}</span>
                <span className={d.duelMid}>
                    <span>{row.label}</span>
                    <span className={d.bar} aria-hidden="true"><i data-side="you" data-lead={lead === "you" || undefined} style={{ width: `${share}%` }} /><i data-side="them" data-lead={lead === "them" || undefined} /></span>
                </span>
                <span className={d.n} data-side="them" data-lead={lead === "them" || undefined}>{row.them}{row.themOf ? <small>{row.themOf}</small> : null}</span>
            </div>;
        })}
    </div>;
}

/** Duos: everyone you queued with in 5v5 games on the left; on the right, one frame of panels about you and the selected one. */
export default function DuoChemistry({ you, region, agents, mapNames, mapVisuals = {}, onClose, onViewProfile, onCompare }: {
    you: Player; region: string;
    agents: Record<string, AgentInfo>; mapNames: Record<string, string>; mapVisuals?: Record<string, string | undefined>; onClose: () => void;
    onViewProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
    onCompare: (puuid: string) => void;
}) {
    const [partners, setPartners] = useState<ProfileTeammateStat[] | null>(null);
    const [selected, setSelected] = useState("");
    const [details, setDetails] = useState<Record<string, DuoData>>({});
    const [error, setError] = useState("");
    const closeRef = useRef<HTMLButtonElement>(null);
    const colours = usePlayerColours();

    useEffect(() => {
        let alive = true;
        getDuoPartners({ region })
            .then((result) => { if (!alive) return; setPartners(result.partners); setSelected((current) => current || result.partners[0]?.subject || ""); })
            .catch((err) => { if (alive) setError(err instanceof Error ? err.message : String(err)); });
        return () => { alive = false; };
    }, [region]);

    useEffect(() => {
        if (!selected || details[selected]) return;
        let alive = true;
        getDuoChemistry(selected, { region })
            .then((result) => { if (alive) setDetails((current) => ({ ...current, [selected]: result })); })
            .catch((err) => { if (alive) setError(err instanceof Error ? err.message : String(err)); });
        return () => { alive = false; };
    }, [selected, region, details]);

    useEffect(() => {
        closeRef.current?.focus();
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const mate = partners?.find((item) => item.subject === selected);
    const data = selected ? details[selected] : undefined;
    const them: Player = { name: mate?.gameName || "Your duo", tag: mate?.tagLine, cardId: mate?.playerCardId };
    const pairs = data?.pairings.filter((pair) => pair.games >= MIN_PAIR_GAMES).slice(0, 3) ?? [];
    const tops = data ? topAgents(data.pairings) : null;
    const mapId = data ? topMap(data.recent) : undefined;
    const mapArt = mapId ? mapVisuals[mapId] : undefined;
    const agentName = (id: string) => agents[id]?.name || "Agent";

    const who = (player: Player, side: "you" | "them", agent?: string) => <div className={d.who} data-side={side}>
        <span className={d.avatar} data-side={side} aria-hidden="true" style={{ backgroundImage: url(CARD(player.cardId)) }} />
        <span>
            <h3>{player.name}</h3>
            <p><b>{side === "you" ? "You" : "Your duo"}</b>{agent ? <> · mostly {agentName(agent)}</> : null}</p>
        </span>
    </div>;

    const label = (num: string, text: string, extra?: string) => <h4 className={d.label}><b>{num}</b>{text}<span />{extra}</h4>;

    let detail = null;
    if (mate && !data) detail = <div className={d.state} aria-busy="true"><span className={d.spinner} />Reading your games with {them.name}…</div>;
    else if (mate && data && data.games === 0) detail = <p className={d.state}>No 5v5 games with {them.name} yet.</p>;
    else if (mate && data) {
        const line = verdict(data, them.name);
        detail = <div className={d.frame} key={selected}>
            <div className={d.hero} style={{ "--hero-map": url(mapArt) } as CSSProperties}>
                {tops?.you && agents[tops.you]?.full ? <span className={d.agent} data-side="you" aria-hidden="true"><img src={agents[tops.you].full} alt="" /></span> : null}
                {tops?.them && agents[tops.them]?.full ? <span className={d.agent} data-side="them" aria-hidden="true"><img src={agents[tops.them].full} alt="" /></span> : null}
                {who(you, "you", tops?.you)}
                <div className={d.mid}>
                    <b>{data.games}</b>
                    <small>games together · {data.wins} won</small>
                    {mate.gameName ? <button type="button" className={d.compare} onClick={() => onCompare(mate.subject)}>Compare stats</button> : null}
                </div>
                {who(them, "them", tops?.them)}
            </div>

            <section className={`${d.cell} ${d.backup}`}>
                {label("01", "Who backs who up", "5v5 only")}
                <div className={d.verdict}>
                    <p>{line.who ? <em data-side={line.lead}>{line.who}</em> : null}{line.text}</p>
                    <small>{subline(data, them.name)}</small>
                </div>
                <HeadToHead you={you} them={them} rows={[
                    { label: "Avenged the other", hint: "Killed the enemy who had just killed the other one, within 5 seconds. The same rule Insights uses.", you: data.youTradedThem.count, them: data.theyTradedYou.count, youOf: `of ${data.youTradedThem.eligible} deaths`, themOf: `of ${data.theyTradedYou.eligible} deaths` },
                    { label: "Traded a first death", hint: "The other one died first in the round and this player traded it back.", you: data.theirFirstDeathsCovered.count, them: data.yourFirstDeathsCovered.count, youOf: `of ${data.theirFirstDeathsCovered.eligible}`, themOf: `of ${data.yourFirstDeathsCovered.eligible}` },
                    { label: "Assisted the other", hint: "Kills by the other one where this player is in the assist list.", you: data.youAssistedThem, them: data.theyAssistedYou, youOf: "kills", themOf: "kills" },
                ]} />
            </section>

            <section className={`${d.cell} ${d.list2}`}>
                {label("02", "Best agent pairs")}
                {pairs.length ? <ol className={d.rows}>{pairs.map((pair, index) => {
                    const rate = pct(pair.wins, pair.decided);
                    return <li key={pair.you + pair.partner} className={d.pairRow} title={`${agentName(pair.you)} with ${agentName(pair.partner)}`}>
                        <span className={d.num}>{String(index + 1).padStart(2, "0")}</span>
                        <span className={d.tile} aria-hidden="true" style={{ "--a": url(agents[pair.you]?.full), "--b": url(agents[pair.partner]?.full) } as CSSProperties} />
                        <span className={d.copy}><b>{agentName(pair.you)} + {agentName(pair.partner)}</b><small>{pair.games} games</small></span>
                        <span className={d.rate} data-low={rate < 50 || undefined}><b>{rate}%</b><i style={{ "--r": `${rate}%` } as CSSProperties} /></span>
                    </li>;
                })}</ol> : <p className={d.empty}>No agent pair has {MIN_PAIR_GAMES} games yet.</p>}
            </section>

            <section className={`${d.cell} ${d.list2}`}>
                {label("03", "Latest trades")}
                {data.moments.length ? <ol className={d.rows}>{data.moments.slice(0, 3).map((moment, index) => {
                    const art = mapVisuals[moment.mapId.toLowerCase()];
                    const side = moment.kind === "you-traded" ? "you" : "them";
                    return <li key={`${moment.matchId}-${moment.round}-${index}`} className={d.tradeRow} style={{ "--map": url(art) } as CSSProperties}>
                        <span className={d.num}>{String(index + 1).padStart(2, "0")}</span>
                        <span className={d.mini} aria-hidden="true" style={{ backgroundImage: url(CARD(side === "you" ? you.cardId : them.cardId)) }} />
                        <span className={d.copy}><b><em data-side={side}>{side === "you" ? "You" : them.name}</em> avenged {side === "you" ? them.name : "you"}</b><small>{mapNames[moment.mapId.toLowerCase()] || "Map"} · round {moment.round + 1}</small></span>
                        <span className={d.time}>{(moment.gapMillis / 1000).toFixed(1)}s</span>
                    </li>;
                })}</ol> : <p className={d.empty}>No trades between you yet.</p>}
            </section>
        </div>;
    }

    return createPortal(
        <div className={d.backdrop} style={colours.style} role="presentation" onMouseDown={onClose}>
            <section className={d.dialog} role="dialog" aria-modal="true" aria-labelledby="duo-title" style={{ "--window-map": url(mapArt) } as CSSProperties} onMouseDown={(event) => event.stopPropagation()}>
                <header className={d.header}>
                    <h2 id="duo-title">Duos</h2>
                    <p>{mapId && mapNames[mapId] ? <>Most played together lately: <b>{mapNames[mapId]}</b></> : "Everyone you queued with in 5v5 games"}</p>
                    <span className={d.grow} />
                    {mate && data && data.games > 0 ? <ShareButton filename={`vantavault-duo-${(mate.gameName || "duo").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`} build={() => drawDuoShare({
                        you: { name: you.name, cardUrl: CARD(you.cardId), agent: tops?.you ? agents[tops.you]?.full : undefined }, them: { name: them.name, cardUrl: CARD(them.cardId), agent: tops?.them ? agents[tops.them]?.full : undefined },
                        colours: { you: colours.palette.you, them: colours.palette.them }, verdict: verdict(data, them.name), games: data.games, wins: data.wins, mapArt,
                        rows: [
                            { label: "Avenged the other", you: data.youTradedThem.count, them: data.theyTradedYou.count },
                            { label: "Traded a first death", you: data.theirFirstDeathsCovered.count, them: data.yourFirstDeathsCovered.count },
                            { label: "Assisted the other", you: data.youAssistedThem, them: data.theyAssistedYou },
                        ],
                    })} /> : null}
                    {mate?.gameName ? <button type="button" className={d.link} onClick={() => onViewProfile({ puuid: mate.subject, gameName: mate.gameName, tagLine: mate.tagLine })}>View {mate.gameName}&apos;s profile</button> : null}
                    <div className={d.swatches} role="group" aria-label="Player colours">
                        {PLAYER_PALETTES.map((item) => <button key={item.id} type="button" aria-pressed={colours.palette.id === item.id} title={item.name} aria-label={item.name} style={{ "--a": item.you, "--b": item.them } as CSSProperties} onClick={() => colours.choose(item.id)} />)}
                    </div>
                    <button ref={closeRef} type="button" className={d.close} onClick={onClose} aria-label="Close">×</button>
                </header>

                {error ? <p className={d.state}>Couldn&apos;t load your duos. {error}</p>
                    : !partners ? <div className={d.state} aria-busy="true"><span className={d.spinner} />Finding your duos…</div>
                    : !partners.length ? <p className={d.state}>No 5v5 games with a party yet. Skirmish, Deathmatch and custom games aren&apos;t counted.</p>
                    : <div className={d.layout}>
                        <nav className={d.list} aria-label="Duo partners">
                            {partners.map((item) => {
                                const card = CARD(item.playerCardId);
                                return <button key={item.subject} type="button" className={d.partner} aria-current={item.subject === selected || undefined} onClick={() => setSelected(item.subject)}>
                                    {card ? <img src={card} alt="" /> : <i aria-hidden="true" />}
                                    <span><b>{item.gameName || "Hidden player"}</b><small>{item.games} games · {pct(item.wins, item.decided)}% won · {ago(item.lastPlayed)}</small></span>
                                </button>;
                            })}
                        </nav>
                        <div className={d.pane}>{detail}</div>
                    </div>}
            </section>
        </div>,
        document.body,
    );
}
