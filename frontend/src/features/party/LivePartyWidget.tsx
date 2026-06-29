"use client";

import { useEffect, useState } from "react";
import { useData } from "@/context/DataContext";
import type { PartyStatusResponse } from "@/services/api";
import { phaseLabel, phaseShortLabel, queueNameLabel, usePartyAndSocial } from "./usePartyAndSocial";
import styles from "./widget.module.css";

const STORAGE_KEY = "valovault.partyWidget.open";

/**
 * Floating Live Party popup, modeled after the in-page live-chat widgets you
 * see on websites (Intercom, Drift, Crisp). Mount at app level so the widget
 * stays visible across all tabs.
 *
 * States:
 *   - Collapsed: small launcher pill in bottom-right corner
 *   - Expanded:  popup panel above the launcher
 *   - Dismissed: hidden until the user re-opens via the launcher
 *
 * User preference (expanded/collapsed) is persisted in localStorage.
 */
export default function LivePartyWidget() {
    const { activeAccount, playerCards } = useData();
    const { party } = usePartyAndSocial();
    const [open, setOpen] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY);
            if (stored === "true") setOpen(true);
        } catch {
            // localStorage may be unavailable (private mode); ignore.
        }
        setHydrated(true);
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        try {
            window.localStorage.setItem(STORAGE_KEY, open ? "true" : "false");
        } catch {
            // Ignore storage failures.
        }
    }, [open, hydrated]);

    if (!activeAccount) return null;

    const phase = party?.phase;
    const isInGame = phase === "coregame" || phase === "pregame";
    const hasParty = !!party && party.phase !== "none" && party.phase !== "error" && !!party.members?.length;
    const memberCount = party?.members?.length ?? 0;

    // Launcher sub-label + dot
    const dotClass = hasParty
        ? isInGame
            ? `${styles.launcherDot} ${styles.launcherDotInGame}`
            : `${styles.launcherDot} ${styles.launcherDotParty}`
        : styles.launcherDot;
    const launcherSub = party
        ? hasParty
            ? `${memberCount} / 5 members`
            : isInGame
                ? phaseShortLabel(phase)
                : "Solo — waiting for party"
        : "Connecting…";
    const launcherMain = phase && hasParty ? phaseShortLabel(phase) : "Live Party";

    return (
        <div className={`${styles.widget} ${styles.partyAnchor}`} aria-live="polite">
            {open && (
                <PartyPopup
                    party={party}
                    playerCards={playerCards}
                    onClose={() => setOpen(false)}
                />
            )}
            {!open && (
                <button
                    type="button"
                    className={styles.launcher}
                    onClick={() => setOpen(true)}
                    aria-label="Open live party panel"
                >
                    <span className={dotClass} aria-hidden="true" />
                    <span>
                        <span className={styles.launcherLabel}>{launcherMain}</span>
                        <br />
                        <span className={styles.launcherSubLabel}>{launcherSub}</span>
                    </span>
                    {hasParty && (
                        <span className={styles.launcherCount}>{memberCount}/5</span>
                    )}
                </button>
            )}
        </div>
    );
}

function PartyPopup({
    party,
    playerCards,
    onClose,
}: {
    party: PartyStatusResponse | null;
    playerCards: { uuid: string; smallArt?: string; wideArt?: string; largeArt?: string; displayName?: string }[];
    onClose: () => void;
}) {
    // Title reflects actual party state, never just the literal "Live Party".
    // Avoids showing kicker="Live Party" + title="Live Party" duplication in error/empty states.
    const isError = party?.phase === "error";
    const isNone = party?.phase === "none";
    const isConnected = !!party && !isError && !isNone;

    const title = isConnected
        ? phaseLabel(party!.phase, party!.queueId)
        : isError
            ? "Party data unavailable"
            : isNone
                ? "Solo"
                : "Connecting to Riot…";

    const subLabel = isError
        ? "Last sync failed. See error below."
        : isConnected && party?.source
            ? `source: ${party.source === "remote" ? "Riot Server" : "Local Client"}`
            : isNone
                ? "Invite friends or wait for matchmaking to start."
                : "Open Valorant to populate party members, phase, and queue.";

    return (
        <section
            className={styles.panel}
            role="dialog"
            aria-label="Live party"
            aria-modal="false"
        >
            <header className={styles.panelHeader}>
                <div>
                    <div className={styles.panelKicker}>Live Party</div>
                    <div className={styles.panelTitle}>{title}</div>
                    <div className={styles.panelSubLabel}>{subLabel}</div>
                </div>
                <button
                    type="button"
                    className={styles.panelClose}
                    onClick={onClose}
                    aria-label="Close live party panel"
                    title="Close"
                >
                    ×
                </button>
            </header>

            <div className={styles.panelBody}>
                {!party && (
                    <div className={styles.emptyState}>
                        <strong>Connecting to Riot…</strong>
                        Open Valorant to populate party members, phase, and queue.
                    </div>
                )}

                {isError && (
                    <div className={styles.errorBlock}>
                        {party?.error || "Riot Client or local backend did not respond."}
                    </div>
                )}

                {isNone && (
                    <div className={styles.emptyState}>
                        <strong>You're solo.</strong>
                        Invite friends or wait for matchmaking to start.
                    </div>
                )}

                {isConnected && (
                    <>
                        <div className={styles.partyMetaGrid}>
                            <div className={styles.partyMetric}>
                                <span>Members</span>
                                <strong>{party!.members?.length ?? 0} / 5</strong>
                            </div>
                            <div className={styles.partyMetric}>
                                <span>Phase</span>
                                <strong>{party!.phase.toUpperCase()}</strong>
                            </div>
                            <div className={styles.partyMetric}>
                                <span>Queue</span>
                                <strong>{queueNameLabel(party!.queueId) || "—"}</strong>
                            </div>
                            <div className={styles.partyMetric}>
                                <span>Party ID</span>
                                <strong>{party!.partyId ? party!.partyId.slice(0, 8) : "—"}</strong>
                            </div>
                        </div>

                        {party!.members && party!.members.length > 0 && (
                            <div className={styles.partyList}>
                                {party!.members.map((member) => {
                                    const card = member.cardId
                                        ? playerCards.find((c) => c.uuid?.toLowerCase() === member.cardId.toLowerCase())
                                        : undefined;
                                    const icon = card?.smallArt || card?.wideArt || card?.largeArt || "";
                                    return (
                                        <div key={member.puuid} className={styles.partyRow}>
                                            <div className={styles.partyIdentity}>
                                                {icon ? (
                                                    <img src={icon} alt={member.name} className={styles.partyAvatar} />
                                                ) : (
                                                    <div className={styles.partyAvatarFallback} aria-hidden="true" />
                                                )}
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <div className={styles.partyName}>
                                                        <span>{member.name}</span>
                                                        {member.isLocal && (
                                                            <span className={`${styles.partyBadge} ${styles.partyBadgeLocal}`}>YOU</span>
                                                        )}
                                                        {member.isOwner && (
                                                            <span className={styles.partyBadge}>LEAD</span>
                                                        )}
                                                    </div>
                                                    <span className={styles.partyNameMeta}>
                                                        Level {member.accountLevel || "—"}
                                                        {member.competitiveTier > 0 ? ` · Tier ${member.competitiveTier}` : ""}
                                                    </span>
                                                </div>
                                            </div>
                                            <span className={member.isReady ? styles.partyReady : styles.partyReadyNot}>
                                                {member.isReady ? "Ready" : "Not Ready"}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </section>
    );
}