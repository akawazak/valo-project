"use client";

import { useEffect, useState } from "react";
import { useData } from "@/context/DataContext";
import type { SocialPresence, SocialStatusResponse } from "@/services/api";
import { usePartyAndSocial } from "./usePartyAndSocial";
import styles from "./widget.module.css";

const STORAGE_KEY = "valovault.friendsWidget.open";

/**
 * Floating Friend Presence popup, stacked above LivePartyWidget in the
 * bottom-right corner. Same chat-widget pattern (collapsed launcher pill →
 * expanded popup on click), with localStorage persistence.
 */
export default function FriendPresenceWidget() {
    const { activeAccount } = useData();
    const { social } = usePartyAndSocial();
    const [open, setOpen] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (stored === "true") setOpen(true);
        } catch {
            // ignore
        }
        setHydrated(true);
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        try {
            window.localStorage.setItem(STORAGE_KEY, open ? "true" : "false");
        } catch {
            // ignore
        }
    }, [open, hydrated]);

    if (!activeAccount) return null;

    const online = social?.onlineCount ?? 0;
    const inGame = social?.inGameCount ?? 0;
    const total = social?.friendCount ?? 0;
    const launcherMain = online > 0 ? `${online} friends online` : "Friends";
    const launcherSub = social
        ? inGame > 0
            ? `${inGame} in VALORANT · ${total} total`
            : `${total} on roster`
        : "Connecting…";

    return (
        <div className={`${styles.widget} ${styles.friendsAnchor}`} aria-live="polite">
            {open && (
                <FriendsPopup social={social} onClose={() => setOpen(false)} />
            )}
            {!open && (
                <button
                    type="button"
                    className={styles.launcher}
                    onClick={() => setOpen(true)}
                    aria-label="Open friend presence panel"
                >
                    <span
                        className={
                            online > 0
                                ? `${styles.launcherDot} ${styles.launcherDotParty}`
                                : styles.launcherDot
                        }
                        aria-hidden="true"
                    />
                    <span>
                        <span className={styles.launcherLabel}>{launcherMain}</span>
                        <br />
                        <span className={styles.launcherSubLabel}>{launcherSub}</span>
                    </span>
                    {inGame > 0 && (
                        <span className={styles.launcherCount}>{inGame} in-game</span>
                    )}
                </button>
            )}
        </div>
    );
}

function presenceDotClass(presence: SocialPresence | undefined): string {
    if (!presence) return styles.presenceDotOffline;
    if (presence.queueId || /in.?game|match/i.test(presence.state || "")) {
        return styles.presenceDotGame;
    }
    if ((presence.state || "").toLowerCase() === "offline") {
        return styles.presenceDotOffline;
    }
    return styles.presenceDotOnline;
}

function presenceSubLabel(presence: SocialPresence): string {
    const product = presence.product || "Online";
    const state = presence.queueId ? (presence.queueId.charAt(0).toUpperCase() + presence.queueId.slice(1)) : presence.state;
    return state ? `${product} · ${state}` : product;
}

function FriendsPopup({
    social,
    onClose,
}: {
    social: SocialStatusResponse | null;
    onClose: () => void;
}) {
    const sourceLabel =
        social?.source === "local"
            ? "Local Riot Client"
            : social?.remoteStatus === "config" || social?.remoteStatus === "connecting" || social?.remoteStatus === "live"
                ? "Riot Token"
                : social?.source || "Unavailable";

    const presences = (social?.presences || []).filter(
        (presence) => !!(presence.name || presence.product || presence.state || presence.queueId),
    );

    return (
        <section
            className={styles.panel}
            role="dialog"
            aria-label="Friend presence"
            aria-modal="false"
        >
            <header className={styles.panelHeader}>
                <div>
                    <div className={styles.panelKicker}>Friend Presence</div>
                    <div className={styles.panelTitle}>{social?.onlineCount ?? 0} online</div>
                    <div className={styles.panelSubLabel}>
                        source: {sourceLabel}
                    </div>
                </div>
                <button
                    type="button"
                    className={styles.panelClose}
                    onClick={onClose}
                    aria-label="Close friend presence panel"
                    title="Close"
                >
                    ×
                </button>
            </header>

            <div className={styles.panelBody}>
                {!social && (
                    <div className={styles.emptyState}>
                        <strong>Connecting to Riot…</strong>
                        Reading /chat/v4 from your local Riot Client.
                    </div>
                )}

                {social?.status === "unavailable" && social.error && (
                    <div className={styles.errorBlock}>{social.error}</div>
                )}

                {social && social.status !== "unavailable" && (
                    <div className={styles.presenceCounters}>
                        <div className={styles.presenceCounter}>
                            Online <strong>{social.onlineCount ?? 0}</strong>
                        </div>
                        <div className={styles.presenceCounter}>
                            In VALORANT <strong>{social.inGameCount ?? 0}</strong>
                        </div>
                        <div className={styles.presenceCounter}>
                            Total <strong>{social.friendCount ?? 0}</strong>
                        </div>
                    </div>
                )}

                {presences.length === 0 && social && social.status !== "unavailable" && (
                    <div className={styles.emptyState}>
                        <strong>No friends online.</strong>
                        When friends come online they'll show up here.
                    </div>
                )}

                {presences.length > 0 && (
                    <div className={styles.presenceList}>
                        {presences.slice(0, 10).map((presence, index) => (
                            <div key={presence.puuid || `${presence.name}-${index}`} className={styles.presenceRow}>
                                <span
                                    className={`${styles.presenceDot} ${presenceDotClass(presence)}`}
                                    aria-hidden="true"
                                />
                                <div style={{ minWidth: 0, flex: 1 }}>
                                    <span className={styles.presenceName}>
                                        {presence.name || "Unknown friend"}
                                    </span>
                                    <span className={styles.presenceSub}>{presenceSubLabel(presence)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </section>
    );
}
