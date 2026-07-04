"use client";

import { useRef, useEffect, useCallback } from "react";
import { RiotAccount } from "@/lib/types";
import Image from "next/image";

interface AppTopbarProps {
    activeTab: "home" | "store" | "skins" | "profile";
    onTabChange: (tab: "home" | "store" | "skins" | "profile") => void;
    activeAccount: RiotAccount | null;
    useLocalSso: boolean;
    isLocalClientActive: boolean;
    isBackendOnline?: boolean;
    onOpenSettings: () => void;
    onOpenAccounts: () => void;
}

const TABS: Array<{ key: AppTopbarProps["activeTab"]; label: string }> = [
    { key: "home", label: "Home" },
    { key: "store", label: "Storefront" },
    { key: "profile", label: "Profile" },
    { key: "skins", label: "Presets" },
];

export default function AppTopbar({
    activeTab,
    onTabChange,
    activeAccount,
    useLocalSso,
    isLocalClientActive,
    isBackendOnline = true,
    onOpenSettings,
    onOpenAccounts,
}: AppTopbarProps) {
    const accountLabel = (acc: RiotAccount) => `${acc.gameName}#${acc.tagLine}`;
    const navRef = useRef<HTMLElement>(null);
    const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    // Slide the pill indicator behind the active tab
    const updateIndicator = useCallback(() => {
        const nav = navRef.current;
        if (!nav) return;
        const btn = btnRefs.current.get(activeTab);
        if (!btn) return;
        const navRect = nav.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        nav.style.setProperty(
            "--nav-indicator-left",
            `${btnRect.left - navRect.left}px`
        );
        nav.style.setProperty(
            "--nav-indicator-width",
            `${btnRect.width}px`
        );
    }, [activeTab]);

    useEffect(() => {
        updateIndicator();
        const raf = requestAnimationFrame(updateIndicator);
        return () => cancelAnimationFrame(raf);
    }, [updateIndicator]);

    return (
        <header className="app-topbar">
            {!isBackendOnline && (
                <div className="backend-offline-banner" role="status">
                    Backend offline. Restart VantaVault so Tauri can relaunch the backend.
                </div>
            )}
            <div className="topbar-inner">
                <button type="button" className="topbar-brand" onClick={() => onTabChange("home")}>
                    <Image className="brand-mark brand-mark-img" src="/brand-mark.svg" alt="" width={30} height={30} priority />
                    <span>
                        VANTA<span>VAULT</span>
                    </span>
                </button>
                <nav className="topbar-nav" ref={navRef} aria-label="Primary">
                    {TABS.map(({ key, label }) => (
                        <button
                            key={key}
                            ref={(el) => {
                                if (el) btnRefs.current.set(key, el);
                            }}
                            type="button"
                            className={activeTab === key ? "active" : ""}
                            onClick={() => onTabChange(key)}
                        >
                            {label}
                        </button>
                    ))}
                </nav>

                <div className="topbar-actions">
                    {/* Profile Pill */}
                    <button
                        type="button"
                        className={`profile-pill-trigger ${activeAccount ? "has-account" : ""}`}
                        onClick={onOpenAccounts}
                        title="Manage Accounts"
                    >
                        <div className="profile-pill-avatar">
                            {useLocalSso ? (
                                <svg className="pill-avatar-svg local-sso" viewBox="0 0 24 24" fill="currentColor">
                                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                                </svg>
                            ) : (
                                <svg className="pill-avatar-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                    <circle cx="12" cy="7" r="4" />
                                </svg>
                            )}
                        </div>
                        <div className="profile-pill-info">
                            <span className="profile-pill-name">
                                {useLocalSso
                                    ? isLocalClientActive
                                        ? activeAccount
                                            ? accountLabel(activeAccount)
                                            : "Local Client"
                                        : "Waiting for Client"
                                    : activeAccount
                                    ? accountLabel(activeAccount)
                                    : "Connect Account"}
                            </span>
                            <span
                                className={`profile-status-indicator ${
                                    useLocalSso
                                        ? isLocalClientActive
                                            ? "online"
                                            : "waiting"
                                        : activeAccount
                                        ? "online"
                                        : "offline"
                                }`}
                            />
                        </div>
                    </button>

                    {/* Settings Gear Button */}
                    <button
                        type="button"
                        className="topbar-settings-btn"
                        onClick={onOpenSettings}
                        title="Open Settings"
                    >
                        <svg className="settings-gear-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="3" />
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                    </button>
                </div>
            </div>
        </header>
    );
}
