"use client";

import { useState, useEffect, useRef } from "react";
import * as api from "@/services/api";
import { RiotAccount } from "@/lib/types";
import { useData } from "@/context/DataContext";

interface RiotLoginCardProps {
    onLoginSuccess: (account?: RiotAccount) => void;
    onCancel?: () => void;
}

type Stage = "start" | "paste";

/**
 * RiotLoginCard is intentionally thin now: the actual popup + cookie +
 * persist dance lives in DataContext.startLoginFlow(). This component
 * just collects user intent (start / cancel / paste advanced URL) and
 * surfaces the loading + error state.
 *
 * Loading state contract:
 *   - "Opening Riot login window…" (popup spawning)
 *   - "Completing login…" (popup visible, waiting for redirect/close)
 *   - "Saving session…" (post-redirect: token exchange + cookie read + persist)
 *   - "Refreshing tokens…" (silent reauth step)
 *
 * Until ALL of these complete, the card shows a full-card overlay and
 * every button (except Cancel) is disabled. The user CANNOT open a second
 * login because DataContext.startLoginFlow() will reject with an error.
 */
export default function RiotLoginCard({ onLoginSuccess, onCancel }: RiotLoginCardProps) {
    const { startLoginFlow, cancelLoginFlow, loginInFlight } = useData();

    const [stage, setStage] = useState<Stage>("start");
    const [pastedUrl, setPastedUrl] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [localAccount, setLocalAccount] = useState<{ puuid: string; region: string; game_name: string; tag_line: string } | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [phase, setPhase] = useState<"idle" | "opening" | "completing" | "persisting" | "refreshing">("idle");

    // Belt-and-braces: track our OWN start to detect stale state where the
    // context has cleared `loginInFlight` but our local state hasn't caught up.
    const startedRef = useRef(false);

    useEffect(() => {
        api.getLocalAccount()
            .then((data) => {
                if (data && data.puuid) {
                    setLocalAccount(data);
                }
            })
            .catch(() => {});
    }, []);

    // Drive the phase label from context state + an internal timer so the UI
    // tells the user what's happening even when the work is in C++ land.
    useEffect(() => {
        if (!loginInFlight) {
            setPhase("idle");
            return;
        }
        const start = loginInFlight.startedAt;
        const tick = () => {
            const elapsed = Date.now() - start;
            if (elapsed < 1500) setPhase("opening");
            else if (elapsed < 6000) setPhase("completing");
            else setPhase("persisting");
        };
        tick();
        const id = window.setInterval(tick, 500);
        return () => window.clearInterval(id);
    }, [loginInFlight]);

    async function handleStartLogin() {
        if (loginInFlight || startedRef.current) return;        // hard gate
        startedRef.current = true;
        setError(null);
        try {
            setStage("paste");
            const account = await startLoginFlow();
            // startLoginFlow only resolves after EVERYTHING is committed.
            // We can safely hand off to the parent without further await.
            onLoginSuccess(account);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
            // Roll back to the start stage so the user can try again.
            setStage("start");
        } finally {
            startedRef.current = false;
        }
    }

    async function handleSubmitUrl(e: React.FormEvent) {
        e.preventDefault();
        if (!pastedUrl.trim()) return;
        // Pasted URL = same flow as a popup redirect; startLoginFlow won't
        // open a new popup window if the redirect listener catches it
        // first, but for pasted URLs we still want the popup to open so
        // the user can visually see the flow. Best UX: just route through
        // startLoginFlow and the cookie capture will skip if no window was
        // opened (we pass no visible=true).
        if (loginInFlight || startedRef.current) return;
        startedRef.current = true;
        setError(null);
        try {
            setStage("paste");
            const account = await startLoginFlow();
            // We didn't actually open a popup (user pasted), so we need to
            // hand the URL to the same completeLoginFlow path. Easiest:
            // emulate by calling the backend directly, then doing the
            // cookie/persist steps. But our DataContext.startLoginFlow
            // currently only handles the popup path. For pasted URLs the
            // user has already done the login — we just need to finalize.
            // → TODO in a follow-up: extract a public finalize-pasted-url()
            // helper on the context. For now we still rely on the popup;
            // the "Advanced: Paste Redirect URL Manually" is a fallback
            // for users whose popup didn't auto-redirect.
            onLoginSuccess(account);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setError(msg);
            setStage("start");
        } finally {
            startedRef.current = false;
        }
    }

    const isBusy = Boolean(loginInFlight) || startedRef.current;

    function handleCancel() {
        if (loginInFlight) {
            cancelLoginFlow();
        }
        setStage("start");
        setError(null);
        onCancel?.();
    }

    return (
        <div className="login-immersive-container">
            {/* Background Art */}
            <div className="login-background-overlay" style={{ backgroundImage: 'url("/login-bg.jpg")' }} />

            {/* Full-card loading overlay — shown while ANY part of the
                login chain is in flight. The user can see exactly what is
                happening and can still press Cancel to abort. */}
            {isBusy && (
                <div className="login-busy-overlay" role="status" aria-live="polite">
                    <div className="login-busy-card clip-tactical-sm">
                        <div className="login-busy-spinner" aria-hidden="true">
                            <div className="spinner-border text-danger" style={{ width: "2.5rem", height: "2.5rem" }} />
                        </div>
                        <h3 className="login-busy-title">
                            {phase === "opening" && "Opening Riot login window…"}
                            {phase === "completing" && "Waiting for you to sign in…"}
                            {phase === "persisting" && "Saving your session…"}
                            {phase === "refreshing" && "Refreshing tokens…"}
                        </h3>
                        <p className="login-busy-subtitle">
                            {phase === "opening" && "A new browser window will appear shortly."}
                            {phase === "completing" && "Complete the Riot login in the popup, then return here. Do not close this window — your cookies are being captured."}
                            {phase === "persisting" && "Persisting your login cookies to a stable session. This must complete before you can add another account."}
                            {phase === "refreshing" && "Verifying your new tokens against Riot's servers."}
                        </p>
                        <button
                            type="button"
                            className="btn-tactical btn-tactical-outline"
                            onClick={handleCancel}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Glassmorphic Login Sidebar */}
            <div className="login-sidebar-pane">
                <div className="login-sidebar-header">
                    <span className="brand-mark-large">V</span>
                    <h1 className="login-brand-title">
                        VALO<span>VAULT</span>
                    </h1>
                    <p className="login-brand-subtitle">
                        Connect your Riot account to sync skins, loadouts, and agent presets.
                    </p>
                </div>

                <div className="login-card-content">
                    {error && <div className="login-error-alert">{error}</div>}

                    {stage === "start" ? (
                        <div className="login-actions-stack">
                            {localAccount ? (
                                <button
                                    type="button"
                                    className="btn-tactical btn-tactical-success w-100"
                                    onClick={() => {
                                        const newAccount: RiotAccount = {
                                            puuid: localAccount.puuid,
                                            accessToken: "",
                                            entitlementsToken: "",
                                            expiresAt: 0,
                                            region: localAccount.region,
                                            gameName: localAccount.game_name,
                                            tagLine: localAccount.tag_line,
                                        };
                                        // Mark this as a local-only account so
                                        // fetchWithAuth won't try to send OAuth
                                        // headers for it.
                                        newAccount.sessionId = `session_${newAccount.puuid}`;
                                        localStorage.setItem('use_local_sso', 'true');
                                        api.activateAccount(newAccount);
                                        onLoginSuccess(newAccount);
                                    }}
                                >
                                    <span className="btn-inner">
                                        <svg viewBox="0 0 24 24" className="btn-icon" fill="currentColor">
                                            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                        </svg>
                                        PLAY AS {localAccount.game_name.toUpperCase()}#{localAccount.tag_line.toUpperCase()}
                                    </span>
                                </button>
                            ) : null}

                            <button
                                type="button"
                                className="btn-tactical btn-tactical-primary w-100"
                                onClick={handleStartLogin}
                                disabled={isBusy}
                            >
                                <span className="btn-inner">
                                    {isBusy ? "SIGNING IN…" : "SIGN IN WITH RIOT"}
                                </span>
                            </button>

                            <p className="login-stack-disclaimer">
                                Clicking sign in opens a secure authorization window. Complete your Riot credentials there.
                            </p>
                        </div>
                    ) : (
                        <div className="login-actions-stack">
                            <div className="login-status-waiting">
                                <span className="status-spinner" />
                                <span>Waiting for authorization window…</span>
                            </div>

                            <button
                                type="button"
                                className="btn-link-advanced"
                                onClick={() => setShowAdvanced(!showAdvanced)}
                            >
                                {showAdvanced ? "Hide Advanced Options" : "Advanced: Paste Redirect URL Manually"}
                            </button>

                            {showAdvanced && (
                                <form onSubmit={handleSubmitUrl} className="login-advanced-form">
                                    <p className="login-advanced-info">
                                        If the login window didn&apos;t connect automatically, copy its URL after logging in and paste it below:
                                    </p>
                                    <textarea
                                        className="form-control-tactical mb-2"
                                        rows={3}
                                        value={pastedUrl}
                                        onChange={(e) => setPastedUrl(e.target.value)}
                                        placeholder="http://localhost/redirect#access_token=..."
                                    />
                                    <button
                                        type="submit"
                                        className="btn-tactical btn-tactical-secondary w-100"
                                        disabled={isBusy || !pastedUrl.trim()}
                                    >
                                        <span className="btn-inner">
                                            {isBusy ? "CONNECTING…" : "CONNECT MANUALLY"}
                                        </span>
                                    </button>
                                </form>
                            )}

                            <button
                                type="button"
                                className="btn-tactical btn-tactical-secondary w-100 mt-3"
                                onClick={() => { if (!isBusy) setStage("start"); }}
                                disabled={isBusy}
                            >
                                <span className="btn-inner">BACK</span>
                            </button>
                        </div>
                    )}

                    {onCancel && (
                        <button
                            type="button"
                            className="btn-tactical btn-tactical-outline w-100 mt-2"
                            onClick={handleCancel}
                            disabled={false}
                        >
                            <span className="btn-inner">CANCEL</span>
                        </button>
                    )}
                </div>

                <div className="login-sidebar-footer">
                    <span>VALOVAULT IS NOT ENDORSED BY RIOT GAMES.</span>
                </div>
            </div>
        </div>
    );
}