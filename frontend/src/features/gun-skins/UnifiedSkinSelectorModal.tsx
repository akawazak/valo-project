"use client";

import { useState, useMemo, useEffect } from "react";
import Image from "next/image";
import SkinVideoModal from "@/components/SkinVideoModal";
import SkinVideoPlayer from "@/components/SkinVideoPlayer";
import { useData } from "@/context/DataContext";
import { Weapon, Skin, LoadoutItemV1 } from "@/lib/types";

type UnifiedSkinSelectorModalProps = {
    weapon: Weapon;
    ownedLevelIDs: string[];
    ownedChromaIDs: string[];
    currentLoadout: Record<string, LoadoutItemV1>;
    selectedItem: LoadoutItemV1 | undefined;
    parentItem: LoadoutItemV1 | undefined;
    onSkinSelect: (skinId: string, levelId: string, chromaId: string) => void;
    onBuddySelect: (charmID: string, charmLevelID: string) => void;
    onApplyWeapon: () => void;
    saveAction?: { label: string; detail: string; onSave: () => void };
    editingContext: string;
    show: boolean;
    onClose: () => void;
};

const TIER_COLORS: Record<string, string> = {
    "12683d2c-44af-d54e-12a6-cf4fb56b09d7": "#5e9296",
    "0c052332-f437-42f8-a2e6-8f4a7bf2a75a": "#4a9f6e",
    "7c5ac5b0-49f4-9766-e57e-de0e08ee30b8": "#8e5bc8",
    "4b0f4478-7fb6-7c1b-e23a-6371d8aaf2d4": "#d652a0",
    "3ee4d8e2-4d71-b8b5-f97f-915f0f47d1ee": "#e09c32",
    "dd7f1161-3c94-a4be-9df7-b9e56b073f43": "#f04e50",
    "e1c8a98f-4e32-4964-b1ec-51c66a25216e": "#b44d4d",
    "c564c281-c776-4467-9157-0a94cba04e6b": "#6b7280",
};

export default function UnifiedSkinSelectorModal({
    weapon,
    ownedLevelIDs,
    ownedChromaIDs,
    currentLoadout,
    selectedItem,
    parentItem,
    onSkinSelect,
    onBuddySelect,
    onApplyWeapon,
    saveAction,
    show,
    onClose,
}: UnifiedSkinSelectorModalProps) {
    const { contentTiers, ownedBuddies } = useData();

    // Active item settings
    const activeItem = selectedItem || parentItem;
    const defaultSkin = weapon.skins.find(s => s.uuid === weapon.defaultSkinUuid);

    // Initial skin level/chroma selection setup
    const initialSkin = useMemo(() => {
        if (activeItem?.skinId) {
            return weapon.skins.find(s => s.uuid === activeItem.skinId) || defaultSkin || weapon.skins[0];
        }
        return defaultSkin || weapon.skins[0];
    }, [activeItem, weapon.skins, defaultSkin]);

    const [selectedSkin, setSelectedSkin] = useState<Skin>(initialSkin);
    const [selectedLevelId, setSelectedLevelId] = useState<string>(activeItem?.skinLevelId || initialSkin.levels[0]?.uuid || "");
    const [selectedChromaId, setSelectedChromaId] = useState<string>(activeItem?.chromaId || initialSkin.chromas[0]?.uuid || "");
    
    // Tab switching state: "skins" or "buddies"
    const [activeTab, setActiveTab] = useState<"skins" | "buddies">("skins");
    const [searchTerm, setSearchTerm] = useState("");
    const [isVideoPlaying, setIsVideoPlaying] = useState(false);
    const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

    // Sync state when weapon or active selection changes
    useEffect(() => {
        if (show && initialSkin) {
            setSelectedSkin(initialSkin);
            setSelectedLevelId(activeItem?.skinLevelId || initialSkin.levels[0]?.uuid || "");
            setSelectedChromaId(activeItem?.chromaId || initialSkin.chromas[0]?.uuid || "");
            setSearchTerm("");
            setActiveTab("skins");
            setIsVideoPlaying(false);
            setIsVideoModalOpen(false);
        }
    }, [show, initialSkin, activeItem]);

    const tierRankMap = useMemo(() => {
        return contentTiers.reduce((acc, tier) => {
            acc[tier.uuid] = tier.rank;
            return acc;
        }, {} as Record<string, number>);
    }, [contentTiers]);

    // Gather owned skins and sort them by tier
    const ownedSkins = useMemo(() => {
        const list = weapon.skins.filter(skin => {
            if (skin.uuid === weapon.defaultSkinUuid) return true; // Default skin is always owned
            const hasOwnedLevel = skin.levels.some(level => ownedLevelIDs.includes(level.uuid));
            const hasOwnedChroma = skin.chromas.some(chroma => ownedChromaIDs.includes(chroma.uuid));
            return hasOwnedLevel || hasOwnedChroma;
        });

        list.sort((a, b) => {
            if (a.uuid === weapon.defaultSkinUuid) return 1;
            if (b.uuid === weapon.defaultSkinUuid) return -1;
            const rankA = tierRankMap[a.contentTierUuid || ""] || 0;
            const rankB = tierRankMap[b.contentTierUuid || ""] || 0;
            if (rankB !== rankA) return rankB - rankA;
            return a.displayName.localeCompare(b.displayName);
        });

        return list;
    }, [weapon.skins, weapon.defaultSkinUuid, ownedLevelIDs, ownedChromaIDs, tierRankMap]);

    const filteredSkins = useMemo(() => {
        return ownedSkins.filter(skin =>
            skin.displayName.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [ownedSkins, searchTerm]);

    const filteredBuddies = useMemo(() => {
        return ownedBuddies.filter(buddy =>
            buddy.displayName.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [ownedBuddies, searchTerm]);

    if (!show) return null;

    // Handlers
    const handleSkinClick = (skin: Skin) => {
        setSelectedSkin(skin);
        setIsVideoPlaying(false);
        setIsVideoModalOpen(false);
        
        // Find default owned level & chroma
        const ownedLevels = skin.levels.filter(l => ownedLevelIDs.includes(l.uuid));
        const defaultLevel = ownedLevels[ownedLevels.length - 1]?.uuid || skin.levels[0]?.uuid || "";
        
        const ownsSkin = skin.uuid === weapon.defaultSkinUuid || ownedLevels.length > 0;
        const availableChromas = skin.chromas.filter((c, index) => index === 0 && ownsSkin || ownedChromaIDs.includes(c.uuid));
        const defaultChroma = availableChromas[0]?.uuid || skin.chromas[0]?.uuid || "";
        
        setSelectedLevelId(defaultLevel);
        setSelectedChromaId(defaultChroma);
        
        onSkinSelect(skin.uuid, defaultLevel, defaultChroma);
    };

    const handleLevelSelect = (levelId: string) => {
        setSelectedLevelId(levelId);
        onSkinSelect(selectedSkin.uuid, levelId, selectedChromaId);
    };

    const handleChromaSelect = (chromaId: string) => {
        setSelectedChromaId(chromaId);
        
        // When picking a chroma, make sure we have a level that supports it (usually final level)
        let levelId = selectedLevelId;
        if (selectedSkin.levels.length > 1) {
            // Find last level
            levelId = selectedSkin.levels[selectedSkin.levels.length - 1].uuid;
            setSelectedLevelId(levelId);
        }
        onSkinSelect(selectedSkin.uuid, levelId, chromaId);
    };

    const handleBuddyClick = (buddyUuid: string, levelUuid: string) => {
        onBuddySelect(buddyUuid, levelUuid);
    };

    const getBuddyUsage = (buddyLevelId: string): number => {
        return Object.values(currentLoadout).filter(item => item.charmLevelID === buddyLevelId).length;
    };

    // Current selection render properties
    const activeChromaObj = selectedSkin.chromas.find(c => c.uuid === selectedChromaId) || selectedSkin.chromas[0];
    const activeLevelObj = selectedSkin.levels.find(level => level.uuid === selectedLevelId) || selectedSkin.levels[0];
    const selectedChromaIndex = selectedSkin.chromas.findIndex(chroma => chroma.uuid === activeChromaObj?.uuid);
    const previewVideoUrl = selectedChromaIndex > 0
        ? activeChromaObj?.streamedVideo || activeLevelObj?.streamedVideo || ""
        : activeLevelObj?.streamedVideo || activeChromaObj?.streamedVideo || "";
    const previewRenderUrl = activeChromaObj?.fullRender || selectedSkin.displayIcon || weapon.displayIcon;
    const tierColor = TIER_COLORS[selectedSkin.contentTierUuid] || "#6b7280";

    // Gun buddy details
    const equippedBuddyLevelId = activeItem?.charmLevelID || "";
    const equippedBuddy = ownedBuddies.find(b => b.levels[0]?.uuid === equippedBuddyLevelId);

    // Filter levels / chromas that the user actually owns
    const ownedLevels = selectedSkin.levels.filter(l => ownedLevelIDs.includes(l.uuid) || selectedSkin.uuid === weapon.defaultSkinUuid);
    const ownsSelectedSkin = selectedSkin.uuid === weapon.defaultSkinUuid || ownedLevels.length > 0;
    const ownedChromas = selectedSkin.chromas.filter((c, index) => (index === 0 && ownsSelectedSkin) || ownedChromaIDs.includes(c.uuid) || selectedSkin.uuid === weapon.defaultSkinUuid);

    const isMelee = weapon.category === "EEquippableCategory::Melee";

    return (<>
        <div className="unified-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="unified-modal-container">
                <button type="button" className="unified-modal-close-btn" onClick={onClose} aria-label="Close">✕</button>

                {/* Grid Split Content */}
                <div className="unified-modal-content">
                    {/* Left Pane: Preview, Chromas, Levels, Buddy */}
                    <div className="unified-modal-left">
                        {/* Preview Render */}
                        <div className={`unified-modal-preview-box${isVideoPlaying ? " is-video" : ""}`}>
                            <div className="unified-modal-card-tier-line" style={{ backgroundColor: tierColor }} />
                            {isVideoPlaying && previewVideoUrl
                                ? <SkinVideoPlayer key={previewVideoUrl} className="unified-modal-inline-player" videoUrl={previewVideoUrl} posterUrl={previewRenderUrl} />
                                : <img src={previewRenderUrl} alt={selectedSkin.displayName} className="unified-modal-preview-img" />}
                        </div>

                        {/* Metadata */}
                        <div className="unified-modal-skin-meta">
                            <h4>{selectedSkin.displayName}</h4>
                            <span>{activeChromaObj?.displayName || "Default Variant"}</span>
                        </div>
                        {(previewVideoUrl || ownedLevels.length > 1) && <div className="preset-inspect-rail">
                            {previewVideoUrl && <button type="button" className="preset-preview-mode" onClick={() => setIsVideoPlaying((playing) => !playing)} aria-label={isVideoPlaying ? "Return to weapon view" : `Play ${selectedSkin.displayName} preview`}><i aria-hidden="true">{isVideoPlaying ? "×" : "▶"}</i>{isVideoPlaying ? "Weapon" : "Preview"}</button>}
                            {previewVideoUrl && isVideoPlaying && <button type="button" className="preset-preview-expand" onClick={() => setIsVideoModalOpen(true)} aria-label={`Open ${selectedSkin.displayName} preview in a large window`} title="Open large preview">↗</button>}
                            {ownedLevels.length > 1 && <div className="preset-level-switcher" aria-label="Upgrade level"><span>Level</span>{ownedLevels.map((level, index) => <button key={level.uuid} type="button" className={selectedLevelId === level.uuid ? "active" : ""} onClick={() => handleLevelSelect(level.uuid)} aria-label={`Show level ${index + 1}`} aria-pressed={selectedLevelId === level.uuid}>{index + 1}</button>)}</div>}
                        </div>}

                        {/* Keep the equipped buddy visible before the variant gallery. */}
                        {!isMelee && (
                            <div className="unified-modal-buddy-section">
                                <div className="unified-modal-section-title">Gun Buddy</div>
                                <button
                                    type="button"
                                    className={`equipped-buddy-pill${activeTab === "buddies" ? " active" : ""}`}
                                    onClick={() => setActiveTab(activeTab === "buddies" ? "skins" : "buddies")}
                                >
                                    <div className="equipped-buddy-icon-wrap">
                                        {equippedBuddy ? (
                                            <img
                                                src={equippedBuddy.levels[0].displayIcon}
                                                alt=""
                                                style={{ width: "85%", height: "85%", objectFit: "contain" }}
                                            />
                                        ) : (
                                            <span style={{ fontSize: "0.95rem" }}>🚫</span>
                                        )}
                                    </div>
                                    <div className="equipped-buddy-info">
                                        <span className="equipped-buddy-label">Current Buddy</span>
                                        <span className="equipped-buddy-name">{equippedBuddy?.displayName || "None"}</span>
                                    </div>
                                    <span style={{ fontSize: "0.6rem", fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
                                        {activeTab === "buddies" ? "SHOW SKINS" : "CHANGE"}
                                    </span>
                                </button>
                            </div>
                        )}

                        {/* Chroma selection (if multiple chromas are owned) */}
                        {ownedChromas.length > 1 && (
                            <div>
                                <div className="unified-modal-section-title">Variants</div>
                                <div className="preset-chroma-gallery">
                                    {ownedChromas.map((chroma, index) => (
                                        <button
                                            key={chroma.uuid}
                                            type="button"
                                            className={selectedChromaId === chroma.uuid ? "active" : ""}
                                            onClick={() => handleChromaSelect(chroma.uuid)}
                                            title={chroma.displayName}
                                            aria-label={index === 0 ? "Show default variant" : `Show variant ${index + 1}`}
                                        >
                                            <img src={chroma.fullRender || chroma.displayIcon || chroma.swatch || previewRenderUrl} alt="" />
                                            {chroma.streamedVideo ? <span aria-hidden="true">▶</span> : null}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}


                    </div>

                    {/* Right Pane: Search list */}
                    <div className="unified-modal-right">
                        {/* Tab Headers */}
                        <div className="unified-modal-tabs-row">
                            <button
                                type="button"
                                className={`unified-modal-tab-btn${activeTab === "skins" ? " active" : ""}`}
                                onClick={() => setActiveTab("skins")}
                            >
                                Skins ({filteredSkins.length})
                            </button>
                            {!isMelee && (
                                <button
                                    type="button"
                                    className={`unified-modal-tab-btn${activeTab === "buddies" ? " active" : ""}`}
                                    onClick={() => setActiveTab("buddies")}
                                >
                                    Buddies ({filteredBuddies.length})
                                </button>
                            )}
                        </div>

                        {/* Search field */}
                        <div className="unified-modal-search-box">
                            <input
                                type="text"
                                placeholder={activeTab === "skins" ? "Search skins…" : "Search gun buddies…"}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor">
                                <path d="M784-120 532-372q-30 24-74 38t-90 14q-117 0-198.5-81.5T88-600q0-117 81.5-198.5T368-880q117 0 198.5 81.5T648-600q0 46-14 90t-38 74l272 252-48 48ZM368-292q128 0 218-90t90-218q0-128-90-218t-218-90q-128 0-218 90t-90 218q0 128 90 218t218 90Z"/>
                            </svg>
                        </div>

                        {/* List grid */}
                        <div className="unified-modal-grid-scroll">
                            {activeTab === "skins" ? (
                                filteredSkins.length === 0 ? (
                                    <div className="skin-list-empty">No skins match your search.</div>
                                ) : (
                                    <div className="unified-modal-cards-grid">
                                        {filteredSkins.map((skin) => {
                                            const isActive = selectedSkin.uuid === skin.uuid;
                                            const skinTierColor = TIER_COLORS[skin.contentTierUuid] || "#6b7280";
                                            // Render using first owned chroma or fallback
                                            const displayChroma = skin.chromas.find(c => ownedChromaIDs.includes(c.uuid)) || skin.chromas[0];
                                            const skinIcon = displayChroma?.fullRender || skin.displayIcon || weapon.displayIcon;

                                            return (
                                                <button
                                                    key={skin.uuid}
                                                    type="button"
                                                    className={`unified-modal-card-item${isActive ? " active" : ""}`}
                                                    onClick={() => handleSkinClick(skin)}
                                                    title={skin.displayName}
                                                >
                                                    <div className="unified-modal-card-tier-line" style={{ backgroundColor: skinTierColor }} />
                                                    <div className="unified-modal-card-img-wrap">
                                                        <img src={skinIcon} alt="" />
                                                    </div>
                                                    <div className="unified-modal-card-info">
                                                        <span className="unified-modal-card-name">{skin.displayName}</span>
                                                        {isActive && <span className="unified-modal-card-status">Equipped</span>}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )
                            ) : (
                                filteredBuddies.length === 0 ? (
                                    <div className="skin-list-empty">No buddies match your search.</div>
                                ) : (
                                    <div className="unified-modal-buddy-grid">
                                        {/* None / Reset Option */}
                                        <button
                                            type="button"
                                            className={`unified-modal-buddy-card${equippedBuddyLevelId === "" ? " active" : ""}`}
                                            onClick={() => handleBuddyClick("", "")}
                                        >
                                            <div className="unified-modal-buddy-card-icon" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.2rem" }}>
                                                🚫
                                            </div>
                                            <span className="unified-modal-buddy-card-name">Remove Buddy</span>
                                        </button>

                                        {filteredBuddies.map((buddy) => {
                                            const lvl = buddy.levels?.[0];
                                            if (!lvl) return null;
                                            
                                            const usage = getBuddyUsage(lvl.uuid);
                                            const isEquipped = equippedBuddyLevelId === lvl.uuid;
                                            // Max amount in use limit (can't equip if all instances are on other weapons)
                                            const isLimitReached = !isEquipped && usage >= buddy.amount;

                                            return (
                                                <button
                                                    key={buddy.uuid}
                                                    type="button"
                                                    className={`unified-modal-buddy-card${isEquipped ? " active" : ""}${isLimitReached ? " disabled" : ""}`}
                                                    onClick={() => !isLimitReached && handleBuddyClick(buddy.uuid, lvl.uuid)}
                                                    title={buddy.displayName}
                                                >
                                                    <div className="unified-modal-buddy-card-icon">
                                                        <Image
                                                            src={lvl.displayIcon}
                                                            alt=""
                                                            fill
                                                            style={{ objectFit: "contain" }}
                                                            unoptimized
                                                        />
                                                    </div>
                                                    <span className="unified-modal-buddy-card-name">{buddy.displayName}</span>
                                                    {isEquipped && (
                                                        <span className="unified-modal-card-status" style={{ color: "var(--green)" }}>
                                                            Equipped
                                                        </span>
                                                    )}
                                                    {isLimitReached && (
                                                        <span className="unified-modal-card-status" style={{ color: "var(--accent)" }}>
                                                            In Use
                                                        </span>
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                </div>
                <div className="unified-modal-footer">
                    <div className="unified-modal-footer-copy">
                        <strong>{selectedSkin.displayName}</strong>
                        <span>Save changes the preset. Apply changes only this weapon in VALORANT.</span>
                    </div>
                    <div className="unified-modal-footer-actions">
                        {saveAction ? (
                            <button type="button" className="btn-tactical btn-tactical-secondary" onClick={saveAction.onSave} title={saveAction.detail}>
                                {saveAction.label}
                            </button>
                        ) : null}
                        <button type="button" className="btn-tactical btn-tactical-accent" onClick={onApplyWeapon}>
                            Apply {weapon.displayName}
                        </button>
                    </div>
                </div>
            </div>
        </div>
        {isVideoModalOpen && previewVideoUrl ? (
            <SkinVideoModal
                title={selectedSkin.displayName}
                videoUrl={previewVideoUrl}
                posterUrl={previewRenderUrl}
                onClose={() => setIsVideoModalOpen(false)}
            />
        ) : null}
    </>);
}
