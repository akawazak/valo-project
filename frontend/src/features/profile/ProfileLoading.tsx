"use client";

import s from "./ProfilePanel.module.css";

type Props = {
    gameName: string;
    tagLine?: string;
    cardArt?: string;
    overviewReady: boolean;
    matchesReady: boolean;
    artReady?: boolean;
    error?: string;
    onBack?: () => void;
    onRetry: () => void;
};

export default function ProfileLoading({ gameName, tagLine, cardArt, overviewReady, matchesReady, artReady = false, error, onBack, onRetry }: Props) {
    const message = error ? "Couldn't load this profile"
        : !overviewReady ? "Loading profile data…"
        : !matchesReady ? "Loading recent matches…"
        : !artReady ? "Preparing player artwork…" : "Opening profile…";
    const steps = [{ label: "Profile data", ready: overviewReady }, { label: "Matches", ready: matchesReady }, { label: "Artwork", ready: artReady }];
    const activeStep = steps.findIndex(step => !step.ready);
    return (
        <section className={s.profileFacade} aria-label="Opening player profile">
            {onBack && <button type="button" className={s.profileFacadeBack} onClick={onBack}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18" /></svg>
                Back to my profile
            </button>}
            <div className={s.profileFacadeContent} data-state={error ? "error" : "loading"}>
                <PlayerCardScan gameName={gameName} cardArt={cardArt} stopped={!!error} />
                <h1 className={s.profileLoadName}>{gameName}</h1>
                {tagLine && <span className={s.profileLoadTag}>#{tagLine}</span>}
                <p className={s.profileLoadStatus} role="status" aria-live="polite" aria-atomic="true">{message}</p>
                {error ? <div className={s.profileLoadError}>
                    <p>{error}</p>
                    <button type="button" className={s.profileLoadRetry} onClick={onRetry}>Try again</button>
                </div> : <ul className={s.profileLoadSteps} aria-label="Profile loading progress">
                    {steps.map(({ label, ready }, index) => (
                        <li key={label} data-state={ready ? "complete" : "pending"} aria-current={index === activeStep ? "step" : undefined}>
                            <span aria-hidden="true">{ready && <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m3 8 3 3 7-7" /></svg>}</span>
                            {label}<span className={s.profileLoadSrOnly}>: {ready ? "Ready" : "Loading"}</span>
                        </li>
                    ))}
                </ul>}
            </div>
        </section>
    );
}

function PlayerCardScan({ gameName, cardArt, stopped = false }: { gameName: string; cardArt?: string; stopped?: boolean }) {
    return <div className={s.profileLoadPortrait} aria-hidden="true">
        <div className={s.profileLoadCard}>
            <span className={s.profileLoadMonogram}>{gameName.slice(0, 1).toUpperCase()}</span>
            {cardArt && <img key={cardArt} src={cardArt} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}
            {!stopped && <span className={s.profileLoadBeam} />}
        </div>
        {!stopped && <div className={s.profileLoadTrack}><span className={s.profileLoadScanHead} /></div>}
        <span className={s.profileLoadCorner} /><span className={s.profileLoadCorner} />
        <span className={s.profileLoadCorner} /><span className={s.profileLoadCorner} />
    </div>;
}

export function ProgressionLoading({ gameName = "Player", cardArt }: { gameName?: string; cardArt?: string }) {
    return <div className={s.progressionLoading}>
        <div className={s.profileFacadeContent}>
            <PlayerCardScan gameName={gameName} cardArt={cardArt} />
            <h3 className={s.profileLoadName}>{gameName}</h3>
            <p className={s.profileLoadStatus} role="status" aria-live="polite" aria-atomic="true">Loading current missions and contracts…</p>
        </div>
    </div>;
}
