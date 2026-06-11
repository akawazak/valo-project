"use client";

import { useState, useEffect, useRef } from "react";
import * as api from "@/services/api";
import { RiotAccount } from "@/lib/types";

interface RiotLoginCardProps {
    onLoginSuccess: (account?: RiotAccount) => void;
    onCancel?: () => void;
}

type Stage = "start" | "paste";

export function getStoredAccounts(): RiotAccount[] {
    try {
        return JSON.parse(localStorage.getItem("riot_accounts") || "[]");
    } catch {
        return [];
    }
}

export function activateAccount(account: RiotAccount) {
    localStorage.setItem("riot_access_token", account.accessToken);
    localStorage.setItem("riot_entitlements", account.entitlementsToken);
    localStorage.setItem("riot_puuid", account.puuid);
    localStorage.setItem("riot_region", account.region);
}

export default function RiotLoginCard({ onLoginSuccess, onCancel }: RiotLoginCardProps) {
    const [stage, setStage] = useState<Stage>("start");
    const [pastedUrl, setPastedUrl] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [localAccount, setLocalAccount] = useState<{ puuid: string; region: string; game_name: string; tag_line: string } | null>(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const currentSessionIdRef = useRef("");

    useEffect(() => {
        api.getLocalAccount()
            .then(data => {
                if (data && data.puuid) {
                    setLocalAccount(data);
                }
            })
            .catch(() => {});
    }, []);

    // Listen for the redirect event from the Tauri main process
    useEffect(() => {
        let unlisten: (() => void) | null = null;

        async function setupListener() {
            try {
                const { listen } = await import("@tauri-apps/api/event");
                const fn = await listen<string>("riot-login-redirect", (event) => {
                    const redirectUrl = event.payload;
                    connectWithUrl(redirectUrl);
                });
                unlisten = fn;
            } catch (err) {
                console.error("Failed to setup Tauri redirect event listener:", err);
            }
        }

        setupListener();

        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    async function connectWithUrl(url: string) {
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.submitTokenUrl(url);
            const newAccount: RiotAccount = {
                puuid: res.puuid,
                accessToken: res.access_token,
                entitlementsToken: res.entitlements_token,
                expiresAt: Date.now() + Math.max(0, (res.expires_in || 3600) - 60) * 1000,
                region: res.region,
                gameName: res.game_name || "Unknown",
                tagLine: res.tag_line || "",
                sessionId: currentSessionIdRef.current || undefined,
            };
            activateAccount(newAccount);
            onLoginSuccess(newAccount);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to complete authentication.");
        } finally {
            setIsLoading(false);
        }
    }

    async function handleStartLogin() {
        setIsLoading(true);
        setError(null);
        try {
            const { auth_url } = await api.getAuthUrl();
            const { invoke } = await import("@tauri-apps/api/core");
            const tempSessionId = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            currentSessionIdRef.current = tempSessionId;
            await invoke("open_login_window", { authUrl: auth_url, sessionId: tempSessionId, visible: true });
            setStage("paste");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to open Riot authorization window.");
        } finally {
            setIsLoading(false);
        }
    }

    async function handleSubmitUrl(e: React.FormEvent) {
        e.preventDefault();
        if (!pastedUrl.trim()) return;
        await connectWithUrl(pastedUrl.trim());
    }

    return (
        <div className="login-immersive-container">
            {/* Background Art */}
            <div className="login-background-overlay" style={{ backgroundImage: 'url("/login-bg.jpg")' }} />

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
                                        activateAccount(newAccount);
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
                                disabled={isLoading}
                            >
                                <span className="btn-inner">
                                    {isLoading ? "LAUNCHING..." : "SIGN IN WITH RIOT"}
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
                                <span>Waiting for authorization window...</span>
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
                                        disabled={isLoading || !pastedUrl.trim()}
                                    >
                                        <span className="btn-inner">
                                            {isLoading ? "CONNECTING..." : "CONNECT MANUALLY"}
                                        </span>
                                    </button>
                                </form>
                            )}

                            <button
                                type="button"
                                className="btn-tactical btn-tactical-secondary w-100 mt-3"
                                onClick={() => setStage("start")}
                            >
                                <span className="btn-inner">BACK</span>
                            </button>
                        </div>
                    )}

                    {onCancel && (
                        <button
                            type="button"
                            className="btn-tactical btn-tactical-outline w-100 mt-2"
                            onClick={onCancel}
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
