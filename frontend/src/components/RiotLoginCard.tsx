"use client";

import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
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
    const [currentSessionId, setCurrentSessionId] = useState("");

    useEffect(() => {
        api.getLocalAccount()
            .then(data => {
                if (data && data.puuid) {
                    setLocalAccount(data);
                }
            })
            .catch(() => {});
    }, []);

    // Listen for the redirect event from the Tauri main process when using the popup window
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
                sessionId: currentSessionId || undefined,
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
            setCurrentSessionId(tempSessionId);
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
        <div className="riot-login-overlay">
            <div className="riot-login-card">
                <h1 className="riot-brand-title">
                    SKIN<span style={{ color: "var(--accent-red)" }}>VAULT</span>
                </h1>
                <p className="riot-brand-subtitle">
                    Connect your Riot Account to view your Daily Store and use SkinVault
                </p>
                {error && <div className="alert alert-danger py-2 text-center">{error}</div>}
                {stage === "start" ? (
                    <>
                        {localAccount && (
                            <button
                                type="button"
                                className="btn btn-outline-success w-100 mb-3 d-flex align-items-center justify-content-center gap-2"
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
                                style={{ borderColor: "#28a745", color: "#28a745" }}
                            >
                                ⚡ Use Active Game Session ({localAccount.game_name}#{localAccount.tag_line})
                            </button>
                        )}
                        <button type="button" className="btn btn-danger w-100 mb-2" onClick={handleStartLogin} disabled={isLoading}>
                            {isLoading ? "Opening…" : "Sign In with Riot"}
                        </button>
                        <p className="text-muted small text-center mt-3">
                            A secure login popup has been opened. Complete your sign-in there to connect automatically.
                        </p>
                    </>
                ) : (
                    <form onSubmit={handleSubmitUrl}>
                        <div className="text-center mb-3">
                            <span className="spinner-border spinner-border-sm text-danger me-2" role="status" />
                            <span className="small text-muted">Waiting for login popup...</span>
                        </div>
                        <label className="form-label small">Or paste redirect URL manually if it didn&apos;t connect</label>
                        <textarea className="form-control mb-2" rows={3} value={pastedUrl} onChange={e => setPastedUrl(e.target.value)} placeholder="http://localhost/redirect#access_token=..." />
                        <button type="submit" className="btn btn-danger w-100" disabled={isLoading || !pastedUrl.trim()}>
                            {isLoading ? "Connecting…" : "Connect Account"}
                        </button>
                        <button type="button" className="btn btn-link w-100 mt-2" onClick={() => setStage("start")}>Back</button>
                    </form>
                )}
                {onCancel && (
                    <button type="button" className="btn btn-outline-secondary w-100 mt-2" onClick={onCancel}>Cancel</button>
                )}
            </div>
        </div>
    );
}
