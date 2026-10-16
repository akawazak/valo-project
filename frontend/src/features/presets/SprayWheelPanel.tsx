"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useData } from "@/context/DataContext";
import { ExpressionSlot, SpraySlot } from "@/lib/types";
import { SPRAY_WHEEL_SLOTS as SPRAY_SLOTS, EMPTY_SPRAY_ID, FLEX_TYPE_ID, SPRAY_TYPE_ID, expressionMetadata, replaceExpressionSlot, resolveExpressions } from "@/lib/spraySlots";
import ResilientAssetImage from "@/components/ResilientAssetImage";

type PickerTab = "sprays" | "flexes";

type SprayWheelPanelProps = {
    currentSprays: SpraySlot[];
    onUpdateSprays: (sprays: SpraySlot[]) => void;
    currentFlexes?: ExpressionSlot[];
    onUpdateFlexes?: (flexes: ExpressionSlot[]) => void;
    currentExpressions?: ExpressionSlot[];
    onUpdateExpressions?: (expressions: ExpressionSlot[]) => void;
    showUnownedCosmetics?: boolean;
};

export default function SprayWheelPanel({
    currentSprays,
    onUpdateSprays,
    currentFlexes = [],
    onUpdateFlexes,
    currentExpressions = [],
    onUpdateExpressions,
    showUnownedCosmetics = false,
}: SprayWheelPanelProps) {
    const { sprays, ownedSprayIDs, flexes } = useData();
    const [modalSlotId, setModalSlotId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<PickerTab>("sprays");
    const [searchQuery, setSearchQuery] = useState("");
    const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);

    const wheel = useMemo(() => resolveExpressions(currentExpressions, currentSprays, currentFlexes), [currentExpressions, currentSprays, currentFlexes]);

    const ownedSpraySet = useMemo(
        () => new Set(ownedSprayIDs.map(id => id.toLowerCase())),
        [ownedSprayIDs],
    );

    const equippedSpraySet = useMemo(
        () => new Set(wheel.filter(slot => slot.typeId.toLowerCase() === SPRAY_TYPE_ID).map(slot => slot.assetId.toLowerCase())),
        [wheel],
    );

    const slotAssetMap = useMemo(() => {
        const map: Record<string, { icon: string; name: string; uuid: string }> = {};
        for (const [index, slot] of SPRAY_SLOTS.entries()) {
            const match = wheel.find(expression => expression.slotIndex === index);
            if (!match) continue;
            const isFlex = match.typeId.toLowerCase() === FLEX_TYPE_ID;
            const spray = !isFlex ? sprays.find(asset => asset.uuid.toLowerCase() === match.assetId.toLowerCase()) : undefined;
            const flex = isFlex ? flexes.find(asset => asset.uuid.toLowerCase() === match.assetId.toLowerCase()) : undefined;
            map[slot.id] = {
                uuid: match.assetId,
                icon: spray?.displayIcon || spray?.fullIcon || spray?.fullTransparentIcon || flex?.displayIcon || "",
                name: spray?.displayName || flex?.displayName || (isFlex ? "Equipped Flex (artwork unavailable)" : "Equipped expression (artwork unavailable)"),
            };
        }
        return map;
    }, [wheel, sprays, flexes]);

    const displaySprays = useMemo(() => {
        const pool = showUnownedCosmetics
            ? sprays
            : sprays.filter(s => ownedSpraySet.has(s.uuid.toLowerCase()) || equippedSpraySet.has(s.uuid.toLowerCase()));
        const sorted = [...pool].sort((a, b) => a.displayName.localeCompare(b.displayName));
        if (!searchQuery) return sorted;
        return sorted.filter(s => s.displayName.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [sprays, ownedSpraySet, equippedSpraySet, searchQuery, showUnownedCosmetics]);

    const activeSlot = SPRAY_SLOTS.find(s => s.id === modalSlotId);
    const pendingSprayAsset = pendingAssetId
        ? sprays.find(spray => spray.uuid.toLowerCase() === pendingAssetId.toLowerCase())
        : undefined;
    const pendingFlexAsset = pendingAssetId
        ? flexes.find(flex => flex.uuid.toLowerCase() === pendingAssetId.toLowerCase())
        : undefined;
    const flexIconSources = (uuid: string, displayIcon?: string) => [
        displayIcon,
        `https://media.valorant-api.com/flex/${uuid.toLowerCase()}/displayicon.png`,
    ];
    const modalOpen = Boolean(activeSlot);

    const displayFlexes = useMemo(() => {
        const equippedFlexSet = new Set(wheel.filter(slot => slot.typeId.toLowerCase() === FLEX_TYPE_ID).map(slot => slot.assetId.toLowerCase()));
        const pool = showUnownedCosmetics
            ? flexes
            : flexes.filter(flex => equippedFlexSet.has(flex.uuid.toLowerCase()));
        const sorted = [...pool].sort((a, b) => {
            if (a.displayName === "None") return -1;
            if (b.displayName === "None") return 1;
            return a.displayName.localeCompare(b.displayName);
        });
        if (!searchQuery) return sorted;
        return sorted.filter(flex => flex.displayName.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [flexes, wheel, searchQuery, showUnownedCosmetics]);

    const openSprayModal = (slotId: string) => {
        setModalSlotId(slotId);
        const index = SPRAY_SLOTS.findIndex(slot => slot.id === slotId);
        const expression = wheel.find(slot => slot.slotIndex === index);
        setPendingAssetId(expression?.assetId || null);
        setActiveTab(expression?.typeId.toLowerCase() === FLEX_TYPE_ID ? "flexes" : "sprays");
        setSearchQuery("");
    };

    const handleCloseModal = () => {
        setModalSlotId(null);
        setPendingAssetId(null);
        setActiveTab("sprays");
        setSearchQuery("");
    };

    const handleApplySelection = () => {
        if (!activeSlot || !pendingAssetId) return;
        const slotIndex = SPRAY_SLOTS.findIndex(slot => slot.id === activeSlot.id);
        const original = wheel.find(expression => expression.slotIndex === slotIndex);
        const originalType = original?.typeId.toLowerCase();
        const preserveUnknown = original && originalType !== SPRAY_TYPE_ID && originalType !== FLEX_TYPE_ID && original.assetId === pendingAssetId;
        const typeId = preserveUnknown ? original.typeId : activeTab === "flexes" && pendingAssetId ? FLEX_TYPE_ID : SPRAY_TYPE_ID;
        const updated = replaceExpressionSlot(wheel, slotIndex, typeId, pendingAssetId || EMPTY_SPRAY_ID);
        if (onUpdateExpressions) onUpdateExpressions(updated);
        else {
            const metadata = expressionMetadata(updated);
            onUpdateSprays(metadata.sprays);
            onUpdateFlexes?.(metadata.flexes);
        }
        handleCloseModal();
    };

    const switchTab = (tab: PickerTab) => {
        setActiveTab(tab);
        setSearchQuery("");
        const index = SPRAY_SLOTS.findIndex(slot => slot.id === modalSlotId);
        const expression = wheel.find(slot => slot.slotIndex === index);
        setPendingAssetId(expression?.typeId.toLowerCase() === (tab === "flexes" ? FLEX_TYPE_ID : SPRAY_TYPE_ID) ? expression.assetId : null);
    };

    return (
        <div className="cosmetics-panel-container">
            <div className="premium-spray-wheel-wrapper">
                <div className="cosmetics-sub-header">Expressions</div>
                <div className="circular-spray-wheel">
                    <div className="circular-spray-wheel-ring" />
                    <div className="circular-spray-wheel-center">Wheel</div>

                    {SPRAY_SLOTS.map(slot => {
                        const equipped = slotAssetMap[slot.id];
                        const className = `circular-spray-slot circular-spray-slot--${slot.position}${equipped ? " is-equipped" : ""}`;
                        return (
                            <button
                                key={slot.id}
                                type="button"
                                className={className}
                                onClick={() => openSprayModal(slot.id)}
                                title={`${slot.name}${equipped ? `: ${equipped.name}` : " (Empty)"}`}
                            >
                                <div className="circular-spray-slot-inner">
                                    {equipped ? (
                                        <ResilientAssetImage sources={[equipped.icon]} alt={equipped.name} fallback={<span className="expression-asset-fallback">{equipped.uuid.toLowerCase() === EMPTY_SPRAY_ID ? "None" : "Equipped"}</span>} />
                                    ) : (
                                        <span className="circular-spray-slot-empty">+</span>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
                <div className="circular-spray-label-hint">Click a slot to configure</div>
            </div>

            {modalOpen && createPortal(
                <div className="unified-modal-overlay" onClick={(e) => e.target === e.currentTarget && handleCloseModal()}>
                    <div className="unified-modal-container spray-picker-modal expression-picker-modal">
                        <div className="unified-modal-header">
                            <div className="unified-modal-title-wrap">
                                <h3 className="unified-modal-title">{activeSlot?.name} — {activeTab === "sprays" ? "Spray" : "Flex"}</h3>
                            </div>
                            <button type="button" className="unified-modal-close-btn" onClick={handleCloseModal} aria-label="Close">
                                ×
                            </button>
                        </div>

                        <div className="unified-modal-content spray-picker-modal-content">
                            <div className="unified-modal-left spray-picker-modal-left">
                                <div className="unified-modal-preview-box spray-picker-modal-preview">
                                    <div className="unified-modal-card-tier-line" style={{ backgroundColor: "var(--accent)" }} />
                                    {activeTab === "sprays" && pendingAssetId ? (
                                        <ResilientAssetImage
                                            sources={[pendingSprayAsset?.displayIcon, pendingSprayAsset?.fullIcon, pendingSprayAsset?.fullTransparentIcon]}
                                            alt={pendingSprayAsset?.displayName || "Selected spray (artwork unavailable)"}
                                            className="unified-modal-preview-img"
                                            style={{ maxHeight: "70%", maxWidth: "70%", objectFit: "contain" }}
                                            fallback={<span className="expression-asset-fallback">{pendingAssetId.toLowerCase() === EMPTY_SPRAY_ID ? "None" : "Selected"}</span>}
                                        />
                                    ) : activeTab === "flexes" && pendingAssetId ? (
                                        <ResilientAssetImage
                                            sources={flexIconSources(pendingFlexAsset?.uuid || pendingAssetId, pendingFlexAsset?.displayIcon)}
                                            alt={pendingFlexAsset?.displayName || "Selected Flex"}
                                            className="unified-modal-preview-img"
                                            style={{ maxHeight: "68%", maxWidth: "68%", objectFit: "contain" }}
                                            fallback={<div className="expression-asset-fallback" aria-hidden="true">FLEX</div>}
                                        />
                                    ) : (
                                        <div className="spray-picker-empty" aria-label="Empty expression slot">-</div>
                                    )}
                                </div>

                                <div className="unified-modal-skin-meta">
                                    <h4>
                                        {activeTab === "sprays" && activeSlot
                                            ? pendingSprayAsset?.displayName || (pendingAssetId ? "Selected spray (artwork unavailable)" : "Empty Slot")
                                            : pendingFlexAsset?.displayName || (pendingAssetId ? "Selected Flex" : "No Flex Selected")}
                                    </h4>
                                    <span>
                                        {activeTab === "sprays"
                                            ? pendingAssetId ? "Selected — keep to use in this slot" : "No spray selected"
                                            : pendingAssetId ? "Selected — keep to use in this slot" : "Choose a Flex for this slot"}
                                    </span>
                                </div>

                                {activeSlot && pendingAssetId && (
                                    <div className="spray-picker-clear-action">
                                        <button
                                            type="button"
                                            className="btn-tactical btn-tactical-ghost"
                                            onClick={() => { setActiveTab("sprays"); setPendingAssetId(EMPTY_SPRAY_ID); }}
                                        >
                                            Clear Slot
                                        </button>
                                    </div>
                                )}

                            </div>

                            <div className="unified-modal-right">
                                <div className="unified-modal-tabs-row expression-tabs-row">
                                    <button
                                        type="button"
                                        className={`unified-modal-tab-btn${activeTab === "sprays" ? " active" : ""}`}
                                        onClick={() => switchTab("sprays")}
                                    >
                                        {showUnownedCosmetics ? "Sprays" : "Owned Sprays"} ({displaySprays.length})
                                    </button>
                                    <button
                                        type="button"
                                        className={`unified-modal-tab-btn${activeTab === "flexes" ? " active" : ""}`}
                                        onClick={() => switchTab("flexes")}
                                    >
                                        {showUnownedCosmetics ? "Flexes" : "Equipped Flexes"} ({displayFlexes.length})
                                    </button>
                                </div>

                                <div className="unified-modal-search-box">
                                    <input
                                        type="text"
                                        placeholder={activeTab === "sprays" ? "Search sprays..." : "Search flexes..."}
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        autoFocus
                                    />
                                    <svg xmlns="http://www.w3.org/2000/svg" height="14" viewBox="0 -960 960 960" width="14" fill="currentColor">
                                        <path d="M784-120 532-372q-30 24-74 38t-90 14q-117 0-198.5-81.5T88-600q0-117 81.5-198.5T368-880q117 0 198.5 81.5T648-600q0 46-14 90t-38 74l272 252-48 48ZM368-292q128 0 218-90t90-218q0-128-90-218t-218-90q-128 0-218 90t-90 218q0 128 90 218t218 90Z" />
                                    </svg>
                                </div>

                                <div className="unified-modal-grid-scroll">
                                    {activeTab === "sprays" ? (
                                        displaySprays.length === 0 ? (
                                            <div className="skin-list-empty">
                                                {showUnownedCosmetics ? "No sprays match your search." : "No owned sprays match your search. Enable locked cosmetics in Settings to browse the full catalog."}
                                            </div>
                                        ) : (
                                            <div className="unified-modal-cards-grid">
                                                {displaySprays.map(spray => {
                                                    const isEquipped = pendingAssetId?.toLowerCase() === spray.uuid.toLowerCase();
                                                    const sprayIcon = spray.displayIcon || spray.fullIcon || spray.fullTransparentIcon;
                                                    return (
                                                        <button
                                                            key={spray.uuid}
                                                            type="button"
                                                            className={`unified-modal-card-item${isEquipped ? " active" : ""}`}
                                                            onClick={() => setPendingAssetId(spray.uuid)}
                                                            title={spray.displayName}
                                                        >
                                                            <div className="unified-modal-card-img-wrap expression-asset-img-wrap">
                                                                <img src={sprayIcon} alt="" style={{ objectFit: "contain" }} />
                                                            </div>
                                                            <div className="unified-modal-card-info">
                                                                <span className="unified-modal-card-name">{spray.displayName}</span>
                                                                {isEquipped && <span className="unified-modal-card-status">Selected</span>}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )
                                    ) : displayFlexes.length === 0 ? (
                                        <div className="skin-list-empty">
                                            {showUnownedCosmetics ? "No flexes match your search." : "No equipped flexes match your search. Enable locked cosmetics in Settings to browse the full catalog."}
                                        </div>
                                    ) : (
                                        <>
                                            <div className="unified-modal-cards-grid expression-flex-grid">
                                                {displayFlexes.map(flex => {
                                                    const isEquipped = pendingAssetId?.toLowerCase() === flex.uuid.toLowerCase();
                                                    return (
                                                        <button
                                                            key={flex.uuid}
                                                            type="button"
                                                            className={`unified-modal-card-item expression-flex-card${isEquipped ? " active" : ""}`}
                                                            onClick={() => setPendingAssetId(flex.uuid)}
                                                            title={flex.displayName}
                                                            disabled={!onUpdateExpressions && !onUpdateFlexes}
                                                        >
                                                            <div className="unified-modal-card-img-wrap expression-asset-img-wrap">
                                                                <ResilientAssetImage
                                                                    sources={flexIconSources(flex.uuid, flex.displayIcon)}
                                                                    alt=""
                                                                    style={{ objectFit: "contain" }}
                                                                    fallback={<span className="expression-asset-fallback">FLEX</span>}
                                                                />
                                                            </div>
                                                            <div className="unified-modal-card-info">
                                                                <span className="unified-modal-card-name">{flex.displayName}</span>
                                                                {isEquipped && <span className="unified-modal-card-status">Selected</span>}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="unified-modal-footer">
                            <div className="unified-modal-footer-copy">
                                <strong>{activeTab === "sprays" ? pendingSprayAsset?.displayName || (pendingAssetId ? "Selected spray" : "Empty spray slot") : pendingFlexAsset?.displayName || (pendingAssetId ? "Selected Flex" : "No flex selected")}</strong>
                                <span>Keep this selection in your preset draft.</span>
                            </div>
                            <div className="unified-modal-footer-actions">
                                <button type="button" className="btn-tactical btn-tactical-ghost" onClick={handleCloseModal}>Cancel</button>
                                <button
                                    type="button"
                                    className="btn-tactical btn-tactical-accent"
                                    onClick={handleApplySelection}
                                    disabled={!pendingAssetId || (activeTab === "flexes" && !onUpdateExpressions && !onUpdateFlexes)}
                                >
                                    Keep Selection
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}
