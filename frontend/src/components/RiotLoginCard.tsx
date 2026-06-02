"use client";

import { useState } from "react";
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

    async function handleStartLogin() {
        setIsLoading(true);
        setError(null);
        try {
            const { auth_url } = await api.getAuthUrl();
            await open(auth_url);
            setStage("paste");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to open Riot authorization URL.");
        } finally {
            setIsLoading(false);
        }
    }

    async function handleSubmitUrl(e: React.FormEvent) {
        e.preventDefault();
        if (!pastedUrl.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            const res = await api.submitTokenUrl(pastedUrl.trim());
            const newAccount: RiotAccount = {
                puuid: res.puuid,
                accessToken: res.access_token,
                entitlementsToken: res.entitlements_token,
                expiresAt: Date.now() + Math.max(0, (res.expires_in || 3600) - 60) * 1000,
                region: res.region,
                gameName: res.game_name || "Unknown",
                tagLine: res.tag_line || "",
            };
            // Don't save here — let the parent (DataContext) handle storage via handleAddNewAccount
            activateAccount(newAccount);
            onLoginSuccess(newAccount);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to complete authentication.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <div className="riot-login-overlay">
            <div className="riot-login-card">
                <h1 className="riot-brand-title">
                    VALO<span style={{ color: "var(--accent-red)" }}>VAULT</span>
                </h1>
                <p className="riot-brand-subtitle">
                    Connect your Riot Account to view your Daily Store and use ValoVault
                </p>
                {error && <div className="alert alert-danger py-2 text-center">{error}</div>}
                {stage === "start" ? (
                    <>
                        <button type="button" className="btn btn-danger w-100 mb-2" onClick={handleStartLogin} disabled={isLoading}>
                            {isLoading ? "Opening…" : "Sign In with Riot"}
                        </button>
                        <p className="text-muted small text-center mt-3">
                            After signing in, copy the full URL from your browser and paste it on the next screen.
                        </p>
                    </>
                ) : (
                    <form onSubmit={handleSubmitUrl}>
                        <label className="form-label small">Paste redirect URL</label>
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
