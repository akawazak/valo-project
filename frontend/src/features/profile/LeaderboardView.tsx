"use client";

import type { ProfileLeaderboard, ProfileLeaderboardPlayer } from "@/services/api";
import l from "./Leaderboard.module.css";

// Leaderboard players are Immortal 1 and up.
const TIER_NAMES: Record<number, string> = { 24: "Immortal 1", 25: "Immortal 2", 26: "Immortal 3", 27: "Radiant" };
const cardArt = (id: string | undefined, kind: "smallart" | "wideart") => (id ? `https://media.valorant-api.com/playercards/${id.toLowerCase()}/${kind}.png` : "");

interface Props {
    data: ProfileLeaderboard | null;
    results: { term: string; players: ProfileLeaderboardPlayer[] } | null;
    loading: boolean;
    query: string;
    setQuery: (value: string) => void;
    load: (reset: boolean, search?: string) => Promise<void>;
    pageSize: number;
    close: () => void;
    openProfile: (profile: { puuid: string; gameName: string; tagLine: string }) => void;
    rankIcons?: Record<number, string>;
    actLabel?: string;
    regionLabel?: string;
    me?: { puuid: string; name: string; cardId?: string };
}

export default function LeaderboardView({ data, results, loading, query, setQuery, load, pageSize, close, openProfile, rankIcons = {}, actLabel, regionLabel, me }: Props) {
    const board = data?.Players || [];
    const searching = !!results;
    const players = results ? results.players : board;
    const more = !searching && players.length < (data?.totalPlayers || 0);
    const podium = searching ? [] : players.filter((player) => player.leaderboardRank <= 3).sort((a, b) => a.leaderboardRank - b.leaderboardRank);
    const rows = searching ? players : players.filter((player) => player.leaderboardRank > 3);
    const topRR = Math.max(1, ...board.map((player) => player.rankedRating));
    const mine = me ? board.find((player) => player.puuid?.toLowerCase() === me.puuid.toLowerCase()) : undefined;
    const open = (player: ProfileLeaderboardPlayer) => { if (player.IsAnonymized || !player.puuid) return; close(); openProfile(player); };
    const name = (player: ProfileLeaderboardPlayer) => (player.IsAnonymized ? "Secret Agent" : player.gameName || "Player");

    return <div className={l.root}>
        <div className={l.toolbar}>
            <div className={l.chips}>{regionLabel ? <span>{regionLabel}</span> : null}{actLabel ? <span>{actLabel}</span> : null}</div>
            <form className={l.search} role="search" onSubmit={(event) => { event.preventDefault(); void load(true); }}>
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search a Riot ID" aria-label="Search a Riot ID" />
                {query || searching ? <button type="button" className={l.clear} onClick={() => { setQuery(""); void load(true, ""); }} aria-label="Clear search">×</button> : null}
                <button type="submit" disabled={loading || !query.trim()}>{loading ? "Loading…" : "Search"}</button>
            </form>
        </div>

        {podium.length ? <div className={l.podium}>
            {[podium[1], podium[0], podium[2]].filter(Boolean).map((player) => <button key={player.puuid || player.leaderboardRank} type="button" className={l.pod} data-rank={player.leaderboardRank} disabled={player.IsAnonymized || !player.puuid} onClick={() => open(player)} style={{ backgroundImage: player.PlayerCardID ? `url(${cardArt(player.PlayerCardID, "wideart")})` : undefined }}>
                <span className={l.podRank}>#{player.leaderboardRank}</span>
                <span className={l.podIn}>
                    <strong>{name(player)}{player.IsAnonymized ? null : <small>#{player.tagLine}</small>}</strong>
                    <b>{player.rankedRating.toLocaleString()} <span>RR</span></b>
                    <small>{player.numberOfWins} wins</small>
                </span>
                {rankIcons[player.competitiveTier] ? <img className={l.podTier} src={rankIcons[player.competitiveTier]} alt="" /> : null}
            </button>)}
        </div> : null}

        {results ? <div className={l.info}>
            <span><b>{results.players.length}</b> {results.players.length === 1 ? "match" : "matches"} for “{results.term}”</span>
            <span className={l.infoNote}>Riot search plus the {board.length.toLocaleString()} loaded rows</span>
        </div> : data ? <div className={l.info}>
            <span><b>{(data.totalPlayers || 0).toLocaleString()}</b> players on the board</span>
            {rankIcons[27] ? <span><img src={rankIcons[27]} alt="" />Radiant at the top</span> : null}
            <span className={l.infoNote}>The board starts at Immortal 1</span>
        </div> : null}

        {loading && !players.length ? <ol className={l.list} aria-busy="true">{Array.from({ length: 8 }, (_, index) => <li key={index} className={l.skeleton}><i /><i /><i /></li>)}</ol> : null}

        <ol className={l.list}>
            {rows.map((player, index) => {
                const previous = rows[index - 1];
                const divider = !searching && previous && previous.competitiveTier !== player.competitiveTier;
                return <li key={player.puuid || player.leaderboardRank} className={l.item}>
                    {divider ? <div className={l.divider}>{rankIcons[player.competitiveTier] ? <img src={rankIcons[player.competitiveTier]} alt="" /> : null}<span>{TIER_NAMES[player.competitiveTier] || "Next tier"} starts at #{player.leaderboardRank}</span><i /></div> : null}
                    <button type="button" className={l.row} data-me={mine?.puuid === player.puuid || undefined} data-anon={player.IsAnonymized || undefined} disabled={player.IsAnonymized || !player.puuid} onClick={() => open(player)}>
                        <span className={l.rank}>{player.leaderboardRank}</span>
                        {player.PlayerCardID ? <img className={l.avatar} src={cardArt(player.PlayerCardID, "smallart")} alt="" /> : <span className={l.avatar} />}
                        <span className={l.name}><strong>{name(player)}</strong><small>{player.IsAnonymized ? "Hidden by the player" : `#${player.tagLine}`}</small></span>
                        {rankIcons[player.competitiveTier] ? <img className={l.tier} src={rankIcons[player.competitiveTier]} alt={TIER_NAMES[player.competitiveTier] || ""} /> : <span />}
                        <span className={l.wins}><b>{player.numberOfWins}</b><small>wins</small></span>
                        <span className={l.bar} aria-hidden="true"><i style={{ width: `${Math.round((player.rankedRating / topRR) * 100)}%` }} /></span>
                        <b className={l.rr}>{player.rankedRating.toLocaleString()} RR</b>
                    </button>
                </li>;
            })}
        </ol>

        {more ? <button type="button" className={l.more} disabled={loading} onClick={() => void load(false, "")}>{loading ? "Loading…" : `Show ${pageSize} more`}</button> : null}
        {data && !players.length && !loading ? <p className={l.empty}>{results ? `No one called “${results.term}” on the loaded board. It lists Immortal 1 and up.` : "No leaderboard players found."}</p> : null}

        {me && !mine && !searching ? <div className={l.me}>
            {me.cardId ? <img className={l.avatar} src={cardArt(me.cardId, "smallart")} alt="" /> : <span className={l.avatar} />}
            <span className={l.name}><strong>You</strong><small>{me.name}</small></span>
            <span className={l.meNote}>Not on the loaded part of the board. It lists Immortal 1 and up; search your Riot ID to check.</span>
        </div> : null}
    </div>;
}
