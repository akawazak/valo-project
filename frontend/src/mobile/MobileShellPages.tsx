"use client";

import { useState } from "react";
import { useData } from "@/context/DataContext";
import type { LiveMatchResponse, LivePlayer } from "@/services/api";
import type { RiotAccount } from "@/lib/types";
import { MobileBackHeader, MobileIcon } from "./MobileKit";
import type { MobileProfileTarget } from "./MobileProfileV2";

export function MobileLoadingV2() {
  return (
    <main className="mv2-loading" role="status" aria-live="polite" aria-busy="true">
      <img src="/brand-mark.svg" alt="" />
      <strong>VantaVault</strong>
      <span>Preparing your home</span>
      <i />
    </main>
  );
}

export function MobileSignInV2({ onConnected }: { onConnected: (account: RiotAccount) => void }) {
  const { startLoginFlow, cancelLoginFlow, loginInFlight, isBackendOnline } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      onConnected(await startLoginFlow());
    } catch (reason) {
      const value = reason instanceof Error ? reason.message : String(reason);
      if (!/cancel/i.test(value)) setError(value);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mv2-auth">
      <header><img src="/brand-mark.svg" alt="" /><strong>VantaVault</strong></header>
      <section>
        <img src="/brand-mark.svg" alt="" />
        <h1>Your VALORANT companion.</h1>
        <p>Store, loadouts, presets, progression, profiles, party and Riot messages—built for your phone.</p>
      </section>
      {error ? <div className="mv2-inline-error">{error}</div> : null}
      <button type="button" className="mv2-primary" onClick={() => void connect()} disabled={busy || Boolean(loginInFlight) || !isBackendOnline}>
        {busy || loginInFlight ? "Waiting for Riot…" : "Continue with Riot"}
      </button>
      {loginInFlight ? <button type="button" className="mv2-text-action" onClick={cancelLoginFlow}>Cancel</button> : null}
      <small>Your credentials stay in Riot’s native sign-in and Android secure storage.</small>
    </main>
  );
}

export function MobileLiveMatchPage({
  match,
  agents,
  onBack,
  onProfile,
}: {
  match: LiveMatchResponse | null;
  agents: ReturnType<typeof useData>["agents"];
  onBack: () => void;
  onProfile: (target: MobileProfileTarget) => void;
}) {
  const players = [...(match?.allyTeam || []), ...(match?.enemyTeam || [])];
  const partyLabels = new Map<string, string>();
  const historyPartySizes = new Map<string, number>();
  for (const player of players) {
    if (player.partyGroup && !partyLabels.has(player.partyGroup)) {
      partyLabels.set(player.partyGroup, "Your party");
    }
    if (player.historyPartyGroup) {
      historyPartySizes.set(player.historyPartyGroup, (historyPartySizes.get(player.historyPartyGroup) || 0) + 1);
    }
  }
  const row = (player: LivePlayer) => {
    const agent = agents.find((item) => item.uuid.toLowerCase() === player.agentId?.toLowerCase());
    const [gameName, ...tagParts] = player.name.split("#");
    const canOpenProfile = Boolean(player.puuid && gameName && !["Agent", "Enemy"].includes(gameName));
    return (
      <button
        type="button"
        key={player.puuid}
        className={player.isLocal ? "local" : ""}
        disabled={!canOpenProfile}
        onClick={() => {
          if (canOpenProfile) onProfile({ puuid: player.puuid, gameName, tagLine: tagParts.join("#"), cardId: player.cardId, autoSyncMatches: false });
        }}
      >
        <span>{agent?.displayIcon ? <img src={agent.displayIcon} alt="" /> : player.name.slice(0, 1)}</span>
        <div>
          <strong>{player.name}{player.isLocal ? " · You" : ""}</strong>
          <small>{agent?.displayName || "Agent"}{player.competitiveTier ? ` · Tier ${player.competitiveTier}` : ""}</small>
          {player.cachedEvidence?.matches ? <em>{player.cachedEvidence.wins || 0}W · {Math.round(player.cachedEvidence.winrate || 0)}% · {(player.cachedEvidence.kd || 0).toFixed(2)} KD · cached</em> : null}
        </div>
        {player.partyGroup ? <i>{partyLabels.get(player.partyGroup)}</i> : player.historyPartyGroup ? (
          <i className="history">Prior {historyPartySizes.get(player.historyPartyGroup) === 2 ? "duo" : `${historyPartySizes.get(player.historyPartyGroup)}-stack`} · {player.historyPartyMatches || 1}</i>
        ) : <MobileIcon name="chevron" size={18} />}
      </button>
    );
  };
  return (
    <div className="mv2-live">
      <MobileBackHeader title="Live match" detail={match?.queueId || "Current Riot match"} onBack={onBack} />
      {!match ? <p className="mv2-muted-row">Loading the current match and cached party information…</p> : (
        <>
          <section className="mv2-live-score">
            <div><span>Your team</span><strong>{match.scoreAvailable ? match.allyScore ?? 0 : "—"}</strong></div>
            <b>VS</b>
            <div><span>Opponents</span><strong>{match.scoreAvailable ? match.enemyScore ?? 0 : "—"}</strong></div>
          </section>
          <div className="mv2-live-status">
            <span>Live roster</span>
            <small>Tap any player to open their profile.</small>
          </div>
          <h2>Your team</h2>
          <div className="mv2-live-team ally">{(match.allyTeam || []).map(row)}</div>
          <h2>Opponents</h2>
          <div className="mv2-live-team enemy">{(match.enemyTeam || []).map(row)}</div>
        </>
      )}
    </div>
  );
}
