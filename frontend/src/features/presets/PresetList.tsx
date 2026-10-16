"use client";

import { Preset, Agent } from "@/lib/types";
import React, { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useData } from "@/context/DataContext";
import { buildPresetApplyRequest, DEFAULT_PRESET_ID } from "@/lib/effectivePreset";
import { CONTENT_TIERS } from "@/lib/contentTiers";

interface PresetListProps {
    presets: Preset[];
    selectedPreset: Preset | null;
    onPresetSelect: (preset: Preset) => void;
    onPresetDelete: (presetId: string) => void;
    onPresetApply: (preset: Preset) => void;
    onPresetRename: (preset: Preset) => void;
    onCreateVariant: (preset: Preset) => void;
    onTogglePreset: (preset: Preset, checked: boolean) => void;
    defaultPreset: Preset;
    agents: Agent[];
    onExportPreset?: (preset: Preset) => void;
    onImportPresetClick?: () => void;
    onNewPreset: () => void;
    loadoutAvailable?: boolean;
}

export default function PresetList({
    presets,
    selectedPreset,
    onPresetSelect,
    onPresetDelete,
    onPresetApply,
    onPresetRename,
    onCreateVariant,
    onTogglePreset,
    defaultPreset,
    agents,
    onExportPreset,
    onImportPresetClick,
    onNewPreset,
    loadoutAvailable = true,
}: PresetListProps) {
    const savedPresets = Array.isArray(presets)
        ? presets.filter((p) => p.uuid !== DEFAULT_PRESET_ID)
        : [];

    const childrenByParent = savedPresets.reduce((acc, preset) => {
        if (preset.parentUuid) {
            (acc[preset.parentUuid] = acc[preset.parentUuid] || []).push(preset);
        }
        return acc;
    }, {} as Record<string, Preset[]>);

    return (
        <div className="preset-dashboard">
            {/* Header / Actions Row */}
            <div className="dashboard-header-row">
                <div>
                    <span className="tactical-kicker">// LOADOUT PROFILES</span>
                    <h1 className="dashboard-title">Preset Dashboard</h1>
                </div>
                <div className="dashboard-buttons">
                    <button
                        type="button"
                        className="btn-tactical btn-tactical-secondary"
                        onClick={onImportPresetClick}
                    >
                        Import Code
                    </button>
                    <button
                        type="button"
                        className="btn-tactical btn-tactical-danger"
                        onClick={onNewPreset}
                        disabled={!loadoutAvailable}
                    >
                        + Create Preset
                    </button>
                </div>
            </div>

            <div className="preset-dashboard-grid">
                {/* Current Loadout Prominent Card */}
                <div
                    className={`preset-dashboard-card current-loadout-card ${
                        selectedPreset?.uuid === defaultPreset.uuid ? "active" : ""
                    }`}
                    onClick={() => onPresetSelect(defaultPreset)}
                >
                    <div className="card-top">
                        <div className="card-badge">{loadoutAvailable ? "LIVE" : "UNAVAILABLE"}</div>
                        <h3 className="card-name">{defaultPreset.name}</h3>
                        <p className="card-desc">{loadoutAvailable ? "Your current in-game weapon skins and cosmetics." : "Renew your Riot session in Account Manager, then refresh to load your equipped cosmetics."}</p>
                    </div>
                    <div className="card-footer">
                        <button
                            type="button"
                            className="btn-card-action"
                            disabled={!loadoutAvailable}
                            onClick={(e) => {
                                e.stopPropagation();
                                onPresetSelect(defaultPreset);
                            }}
                        >
                            View Live Loadout
                        </button>
                    </div>
                </div>

                {/* Saved Presets */}
                {savedPresets.map((preset) => {
                    const variants = childrenByParent[preset.uuid] || [];
                    return (
                        <div key={preset.uuid} className="preset-card-group">
                            <PresetCard
                                preset={preset}
                                isSelected={selectedPreset?.uuid === preset.uuid}
                                onSelect={onPresetSelect}
                                onApply={onPresetApply}
                                onRename={onPresetRename}
                                onDelete={onPresetDelete}
                                onCreateVariant={onCreateVariant}
                                onToggle={onTogglePreset}
                                onExport={onExportPreset}
                                agents={agents}
                                allPresets={presets}
                                variantCount={variants.length}
                                isVariant={Boolean(preset.parentUuid)}
                            />
                        </div>
                    );
                })}

                {savedPresets.length === 0 && (
                    <div className="presets-empty-state">
                        <div className="empty-icon">📂</div>
                        <h3>No Presets Configured</h3>
                        <p>Create a preset to save custom agent loadouts or import a configuration code.</p>
                    </div>
                )}
            </div>
        </div>
    );
}

/* ── Individual Preset Card Component ── */

/** Guns shown on a preset card, most recognisable first; the first equipped one is the hero. */
const PRESET_FEATURED_WEAPONS = [
    "9c82e19d-4575-0200-1a81-3eacf00cf872", // Vandal
    "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a", // Phantom
    "a03b24d3-4319-996d-0f8c-94bbfba1dfc7", // Operator
    "e336c6b8-418d-9340-d77f-7a9e4cfe0702", // Sheriff
    "1baa85b4-4c70-1284-64bb-6481dfc3bb4e", // Ghost
    "2f59173c-4bed-b6c3-2191-dea9b58be9c7", // Melee
    "462080d1-4035-2937-7c09-27aa2a5c27a7", // Spectre
    "29a0cfab-485b-f5d5-779a-b59f85e204a8", // Classic
];

/** valorant-api gradient colours are RRGGBBAA; CSS wants #RRGGBB. */
function agentColor(hex?: string) {
    return hex && /^[0-9a-f]{6}/i.test(hex) ? `#${hex.slice(0, 6)}` : undefined;
}

export function PresetCard({
    preset,
    isSelected,
    onSelect,
    onApply,
    onRename,
    onDelete,
    onCreateVariant,
    onToggle,
    onExport,
    agents,
    allPresets,
    isVariant = false,
    variantCount = 0,
}: {
    preset: Preset;
    isSelected: boolean;
    onSelect: (p: Preset) => void;
    onApply: (p: Preset) => void;
    onRename: (p: Preset) => void;
    onDelete: (id: string) => void;
    onCreateVariant?: (p: Preset) => void;
    onToggle: (p: Preset, checked: boolean) => void;
    onExport?: (p: Preset) => void;
    agents: Agent[];
    allPresets: Preset[];
    isVariant?: boolean;
    variantCount?: number;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuButtonRef = useRef<HTMLButtonElement>(null);
    const [menuAnchor, setMenuAnchor] = useState<{ bottom: number; right: number } | null>(null);

    const { weapons, playerCards, playerTitles = [] } = useData();
    const preview = useMemo(
        () => buildPresetApplyRequest(preset, allPresets),
        [allPresets, preset],
    );
    const previewLoadout = preview.loadout;

    const equippedCard = useMemo(() => {
        const cardId = preview.identity?.playerCardId;
        if (!cardId) return null;
        return playerCards.find(c => c.uuid.toLowerCase() === cardId.toLowerCase());
    }, [preview.identity?.playerCardId, playerCards]);

    const titleText = useMemo(() => {
        const titleId = preview.identity?.playerTitleId;
        if (!titleId) return "";
        return playerTitles.find(t => t.uuid.toLowerCase() === titleId.toLowerCase())?.titleText || "";
    }, [preview.identity?.playerTitleId, playerTitles]);

    // Featured guns (hero first) and how many skins of each edition the preset holds.
    const { featured, rarityCounts, weaponCount } = useMemo(() => {
        const resolve = (weaponId: string) => {
            const equipped = previewLoadout[weaponId];
            const weapon = equipped && weapons.find(w => w.uuid === weaponId);
            const skin = weapon && weapon.skins.find(s => s.uuid === equipped.skinId);
            if (!weapon || !skin) return null;
            const chroma = skin.chromas.find(c => c.uuid === equipped.chromaId);
            const image = chroma?.fullRender || chroma?.displayIcon || skin.displayIcon || "";
            return image ? { name: skin.displayName, image, tier: CONTENT_TIERS[skin.contentTierUuid] } : null;
        };
        const picked = PRESET_FEATURED_WEAPONS.map(resolve).filter((item): item is NonNullable<ReturnType<typeof resolve>> => Boolean(item));
        for (const weaponId of Object.keys(previewLoadout)) {
            if (picked.length >= 6) break;
            if (PRESET_FEATURED_WEAPONS.includes(weaponId)) continue;
            const item = resolve(weaponId);
            if (item) picked.push(item);
        }
        const counts = new Map<string, { tier: (typeof CONTENT_TIERS)[string]; count: number }>();
        for (const [weaponId, equipped] of Object.entries(previewLoadout)) {
            const skin = weapons.find(w => w.uuid === weaponId)?.skins.find(s => s.uuid === equipped.skinId);
            const tier = skin && CONTENT_TIERS[skin.contentTierUuid];
            if (!tier) continue;
            const entry = counts.get(tier.name) || { tier, count: 0 };
            entry.count += 1;
            counts.set(tier.name, entry);
        }
        const tierOrder = ["Ultra", "Exclusive", "Premium", "Deluxe", "Select"];
        return {
            featured: picked.slice(0, 6),
            rarityCounts: [...counts.values()].sort((a, b) => tierOrder.indexOf(a.tier.name) - tierOrder.indexOf(b.tier.name)),
            weaponCount: Object.keys(previewLoadout).length,
        };
    }, [previewLoadout, weapons]);

    useEffect(() => {
        function handleClickOutside(e: MouseEvent) {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const allAssignedAgents = (preset.agents || [])
        .map((id) => agents.find((a) => a.uuid === id))
        .filter((a): a is Agent => !!a);
    const leadAgent = allAssignedAgents[0];
    const agentNames = allAssignedAgents.map((agent) => agent.displayName);
    const [hero, ...minis] = featured;

    const heroStyle = leadAgent
        ? {
            "--agent-a": agentColor(leadAgent.backgroundGradientColors?.[0]) || "#1a2430",
            "--agent-b": agentColor(leadAgent.backgroundGradientColors?.[2]) || agentColor(leadAgent.backgroundGradientColors?.[1]) || "#0f1923",
        } as React.CSSProperties
        : hero?.tier ? { "--tier": hero.tier.color } as React.CSSProperties : undefined;

    const tag = isVariant ? "Variant" : leadAgent && !preset.disabled ? "Auto-applies" : "Preset";
    const subline = leadAgent
        ? `Picks this when you lock ${agentNames.length > 2 ? `${agentNames.slice(0, 2).join(", ")} +${agentNames.length - 2}` : agentNames.join(" or ")}`
        : [hero?.name, titleText].filter(Boolean).join(" · ") || "Any agent";

    return (
        <div
            className={`preset-c2${isSelected ? " active" : ""}${isVariant ? " variant-card" : ""}${preset.disabled ? " disabled-preset" : ""}${leadAgent ? " has-agent" : ""}`}
            onClick={() => onSelect(preset)}
        >
            <div className="preset-c2-hero" style={heroStyle}>
                {leadAgent && (
                    <>
                        {leadAgent.background && <img className="preset-c2-agent-bg" src={leadAgent.background} alt="" draggable={false} />}
                        <img className="preset-c2-agent" src={leadAgent.fullPortrait || leadAgent.displayIcon} alt={leadAgent.displayName} draggable={false} />
                    </>
                )}
                {hero && <img className="preset-c2-gun" src={hero.image} alt={hero.name} title={hero.name} draggable={false} />}
                {hero?.tier && <img className="preset-c2-rarity" src={hero.tier.icon} alt={hero.tier.name} title={`${hero.tier.name} Edition`} />}
                <div className="preset-c2-top">
                    <span className="preset-c2-tag">{tag}</span>
                    <label
                        className="card-switch"
                        title="Auto-apply when matches assigned agent"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <input
                            type="checkbox"
                            checked={!preset.disabled}
                            onChange={(e) => onToggle(preset, e.target.checked)}
                        />
                        <span className="card-switch-slider" />
                    </label>
                </div>
                {leadAgent && (
                    <div className="preset-c2-agents" title={agentNames.join(", ")}>
                        {allAssignedAgents.slice(1, 4).map((agent) => <img key={agent.uuid} src={agent.displayIcon} alt="" />)}
                        <b>{agentNames.length > 2 ? `${agentNames[0]} +${agentNames.length - 1}` : agentNames.join(" · ")}</b>
                    </div>
                )}
            </div>

            <div className="preset-c2-name">
                {equippedCard && (
                    <img className="preset-c2-avatar" src={equippedCard.smallArt || equippedCard.displayIcon} alt={equippedCard.displayName} title={`Card: ${equippedCard.displayName}`} />
                )}
                <div>
                    <h3>{preset.name}</h3>
                    <small>{subline}</small>
                </div>
            </div>

            {minis.length > 0 && (
                <div className="preset-c2-guns">
                    {minis.slice(0, 5).map((item, i) => (
                        <span key={i} title={item.name} style={item.tier ? { "--tier": item.tier.color } as React.CSSProperties : undefined} className={item.tier ? "has-tier" : ""}>
                            <img src={item.image} alt={item.name} />
                        </span>
                    ))}
                </div>
            )}

            <div className="preset-c2-meta">
                <span className="preset-c2-counts">
                    {rarityCounts.map(({ tier, count }) => (
                        <span key={tier.name} title={`${count} ${tier.name} Edition`}><img src={tier.icon} alt="" />{count}</span>
                    ))}
                </span>
                <span className="preset-c2-count">
                    {variantCount > 0 ? `${variantCount} variant${variantCount > 1 ? "s" : ""} · ` : ""}{weaponCount} weapons
                </span>
            </div>

            <div className="preset-c2-actions" onClick={(e) => e.stopPropagation()}>
                <button
                    type="button"
                    className="preset-c2-apply"
                    onClick={(event) => {
                        event.stopPropagation();
                        onApply(preset);
                    }}
                    title="Apply Loadout"
                >
                    Apply
                </button>
                <button
                    type="button"
                    className="preset-c2-btn"
                    onClick={(event) => {
                        event.stopPropagation();
                        onSelect(preset);
                    }}
                    title="Edit Loadout"
                >
                    Edit
                </button>

                <div className="card-more-menu-container" ref={menuRef}>
                    <button
                        type="button"
                        className="preset-c2-btn preset-c2-more"
                        ref={menuButtonRef}
                        onClick={(event) => {
                            event.stopPropagation();
                            if (menuOpen) {
                                setMenuOpen(false);
                                return;
                            }
                            const rect = menuButtonRef.current?.getBoundingClientRect();
                            if (rect) {
                                setMenuAnchor({
                                    bottom: Math.max(8, window.innerHeight - rect.top + 6),
                                    right: Math.max(8, window.innerWidth - rect.right),
                                });
                            }
                            setMenuOpen(true);
                        }}
                        title="More options"
                        aria-label="More options"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" /></svg>
                    </button>
                    {menuOpen && menuAnchor && typeof document !== "undefined" && createPortal(
                        <div
                            ref={menuRef}
                            className="card-dropdown-menu card-dropdown-menu--floating"
                            style={{ bottom: menuAnchor.bottom, right: menuAnchor.right }}
                        >
                            <button
                                type="button"
                                onClick={() => {
                                    onRename(preset);
                                    setMenuOpen(false);
                                }}
                            >
                                Rename
                            </button>
                            {!isVariant && onCreateVariant && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onCreateVariant(preset);
                                        setMenuOpen(false);
                                    }}
                                >
                                    Create Variant
                                </button>
                            )}
                            {onExport && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onExport(preset);
                                        setMenuOpen(false);
                                    }}
                                >
                                    Export Code
                                </button>
                            )}
                            <hr />
                            <button
                                type="button"
                                className="delete"
                                onClick={() => {
                                    onDelete(preset.uuid);
                                    setMenuOpen(false);
                                }}
                            >
                                Delete
                            </button>
                        </div>,
                        document.body,
                    )}
                </div>
            </div>
        </div>
    );
}

/* ── Compact Preset Bar Card (for bottom strip in ArsenalView) ── */
export function PresetBarCard({
    preset,
    isSelected,
    onSelect,
    onApply,
    agents,
    isVariant = false,
}: {
    preset: Preset;
    isSelected: boolean;
    onSelect: (p: Preset) => void;
    onApply: (p: Preset) => void;
    agents: Agent[];
    isVariant?: boolean;
}) {
    const { weapons } = useData();

    const skinPreviews = useMemo(() => {
        if (!preset.loadout) return [];
        const items: Array<{ image: string }> = [];

        const weaponPriority = [
            "ee8e8d15-496b-07ac-e5f6-8fae5d4c7b1a", // Phantom
            "edf530be-4047-020c-7d49-7c2420a9d7dc", // Vandal
            "a03b24d3-472b-9974-bc7e-3141fae62483", // Operator
            "2f59173c-433b-8590-a734-77e485057b24", // Melee
            "1baa85b4-4c70-1284-6d97-f7e170876c64", // Sheriff
        ];

        for (const wUuid of weaponPriority) {
            const equipped = preset.loadout[wUuid];
            if (!equipped) continue;
            const weapon = weapons.find(w => w.uuid === wUuid);
            if (!weapon) continue;
            const skin = weapon.skins.find(s => s.uuid === equipped.skinId);
            if (!skin) continue;
            const chroma = skin.chromas.find(c => c.uuid === equipped.chromaId);
            const image = chroma?.fullRender || chroma?.displayIcon || skin.displayIcon || "";
            if (image) {
                items.push({ image });
            }
        }

        if (items.length < 3) {
            for (const [wUuid, equipped] of Object.entries(preset.loadout)) {
                if (weaponPriority.includes(wUuid)) continue;
                const weapon = weapons.find(w => w.uuid === wUuid);
                if (!weapon) continue;
                const skin = weapon.skins.find(s => s.uuid === equipped.skinId);
                if (!skin) continue;
                const chroma = skin.chromas.find(c => c.uuid === equipped.chromaId);
                const image = chroma?.fullRender || chroma?.displayIcon || skin.displayIcon || "";
                if (image) {
                    items.push({ image });
                }
                if (items.length >= 4) break;
            }
        }

        return items.slice(0, 4);
    }, [preset.loadout, weapons]);

    const assignedAgentId = preset.agents?.[0];
    const assignedAgent = assignedAgentId
        ? agents.find((a) => a.uuid === assignedAgentId)
        : null;

    return (
        <div
            className={`preset-bar-card ${isSelected ? "active" : ""} ${isVariant ? "variant" : ""} ${preset.disabled ? "disabled" : ""}`}
            onClick={() => onSelect(preset)}
            title={preset.name}
        >
            {/* Skin preview strip */}
            <div className="preset-bar-card-media">
                {skinPreviews.length > 0 ? (
                    <div className="preset-bar-skins">
                        {skinPreviews.map((preview, i) => (
                            <div key={i} className="preset-bar-skin-item">
                                <img src={preview.image} alt="" draggable={false} />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="preset-bar-empty">No skins</div>
                )}
            </div>

            <div className="preset-bar-card-footer">
                <div className="preset-bar-card-name-row">
                    <span className="preset-bar-card-name">{preset.name}</span>
                    {assignedAgent && (
                        <img
                            className="preset-bar-agent-icon"
                            src={assignedAgent.displayIcon}
                            alt={assignedAgent.displayName}
                            title={assignedAgent.displayName}
                        />
                    )}
                </div>
                <div className="preset-bar-card-actions">
                    <button
                        type="button"
                        className="preset-bar-apply-btn"
                        onClick={(e) => {
                            e.stopPropagation();
                            onApply(preset);
                        }}
                        title="Apply preset"
                    >
                        ✓
                    </button>
                </div>
            </div>
        </div>
    );
}
