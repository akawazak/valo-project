"use client";

import { useEffect, useMemo, useState } from "react";
import type { RiotAccount } from "@/lib/types";
import { useData } from "@/context/DataContext";
import { getProfileOverview } from "@/services/api";

type HomeDestination = "store" | "profile" | "skins";

interface HomeScreenProps {
    activeAccount: RiotAccount | null;
    isBackendOnline: boolean;
    isClientHealthy: boolean;
    onNavigate: (destination: HomeDestination) => void;
    onCustomize: () => void;
    onManageAccount: () => void;
    playerCardId?: string;
}

export default function HomeScreen({
    activeAccount,
    isBackendOnline,
    isClientHealthy,
    onNavigate,
    onCustomize,
    onManageAccount,
    playerCardId,
}: HomeScreenProps) {
    const { playerCards } = useData();
    const [profileCardId, setProfileCardId] = useState(playerCardId || "");
    const playerName = activeAccount?.gameName || "Player";
    const playerTag = activeAccount?.tagLine ? `#${activeAccount.tagLine}` : "";
    const playerCard = useMemo(
        () => playerCards.find((card) => card.uuid.toLowerCase() === profileCardId.toLowerCase()),
        [playerCards, profileCardId],
    );

    useEffect(() => {
        setProfileCardId(playerCardId || "");
        if (!activeAccount?.puuid) return;
        let cancelled = false;
        void getProfileOverview({ puuid: activeAccount.puuid, region: activeAccount.region })
            .then((overview) => {
                if (!cancelled && overview.playerCardId) setProfileCardId(overview.playerCardId);
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [activeAccount?.puuid, activeAccount?.region, playerCardId]);

    return (
        <section className="home-screen">
            <div className="home-screen-content">
                <nav className="home-launch-nav" aria-label="Home shortcuts">
                    <button type="button" onClick={() => onNavigate("store")}>Storefront</button>
                    <button type="button" onClick={() => onNavigate("profile")}>Profile</button>
                    <button type="button" onClick={() => onNavigate("skins")}>Presets</button>
                </nav>

                <div className="home-welcome">
                    <span>Welcome back</span>
                    <strong>{playerName}</strong>
                    <small>{playerTag || "VantaVault ready"}</small>
                </div>
            </div>

            <aside className="home-account-panel">
                <button
                    type="button"
                    className="home-account-identity"
                    onClick={onManageAccount}
                    style={playerCard?.wideArt ? { backgroundImage: `linear-gradient(90deg, rgba(5, 10, 17, .96), rgba(5, 10, 17, .54)), url("${playerCard.wideArt}")` } : undefined}
                >
                    <span className="home-account-mark" aria-hidden="true">
                        {playerCard?.displayIcon ? <img src={playerCard.displayIcon} alt="" /> : "V"}
                    </span>
                    <span className="home-account-copy">
                        <small>Signed in</small>
                        <strong>{playerName}</strong>
                        <span>{playerTag || "Connect Riot account"}</span>
                    </span>
                </button>
                <div className="home-status-strip">
                    <span className={isBackendOnline ? "online" : "offline"}>Backend {isBackendOnline ? "online" : "offline"}</span>
                    <span className={isClientHealthy ? "online" : "idle"}>Riot {isClientHealthy ? "connected" : "idle"}</span>
                </div>
                <button type="button" className="home-customize-btn" onClick={onCustomize}>Customize appearance</button>
            </aside>
        </section>
    );
}
