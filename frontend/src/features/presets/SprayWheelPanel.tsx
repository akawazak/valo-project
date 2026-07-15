"use client";

import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useData } from "@/context/DataContext";
import { ExpressionSlot, SpraySlot } from "@/lib/types";

const SPRAY_SLOTS = [
    { id: "0812b14c-4120-ed47-5cc2-c6b49b951408", name: "Pre-Round", position: "top" as const },
    { id: "04cbc83a-43cf-aa2a-ee40-a09869679f22", name: "Mid-Round", position: "right" as const },
    { id: "ee063def-4a6b-8254-8e39-16a7eb108e42", name: "Post-Round", position: "bottom" as const },
    { id: "d2b4e425-4a7b-3b3b-81d3-356c9a33bb58", name: "Extra / Wheel", position: "left" as const },
];

type PickerTab = "sprays" | "flexes";

type SprayWheelPanelProps = {
    currentSprays: SpraySlot[];
    onUpdateSprays: (sprays: SpraySlot[]) => void;
    currentFlexes?: ExpressionSlot[];
    onUpdateFlexes?: (flexes: ExpressionSlot[]) => void;
    showUnownedCosmetics?: boolean;
};

export default function SprayWheelPanel({
    currentSprays,
    onUpdateSprays,
    currentFlexes = [],
    onUpdateFlexes,
    showUnownedCosmetics = false,
}: SprayWheelPanelProps) {
    const { sprays, ownedSprayIDs, flexes } = useData();
    const [modalSlotId, setModalSlotId] = useState<string | null>(null);
    const [modalFlexTypeId, setModalFlexTypeId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<PickerTab>("sprays");
    const [searchQuery, setSearchQuery] = useState("");
    const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);

    const ownedSpraySet = useMemo(
        () => new Set(ownedSprayIDs.map(id => id.toLowerCase())),
        [ownedSprayIDs],
    );

    const equippedSpraySet = useMemo(
        () => new Set(currentSprays.map(slot => slot.sprayId.toLowerCase()).filter(Boolean)),
        [currentSprays],
    );

    const slotSprayMap = useMemo(() => {
        const map: Record<string, { icon: string; name: string; uuid: string }> = {};
        for (const slot of SPRAY_SLOTS) {
            const match = currentSprays.find(s => s.equipSlotId.toLowerCase() === slot.id.toLowerCase());
            if (!match) continue;
            const asset = sprays.find(a => a.uuid.toLowerCase() === match.sprayId.toLowerCase());
            if (asset) {
                map[slot.id] = {
                    uuid: asset.uuid,
                    icon: asset.displayIcon || asset.fullIcon || asset.fullTransparentIcon || "",
                    name: asset.displayName,
                };
            }
        }
        return map;
    }, [currentSprays, sprays]);

    const displaySprays = useMemo(() => {
        const pool = showUnownedCosmetics
            ? sprays
            : sprays.filter(s => ownedSpraySet.has(s.uuid.toLowerCase()) || equippedSpraySet.has(s.uuid.toLowerCase()));
        const sorted = [...pool].sort((a, b) => a.displayName.localeCompare(b.displayName));
        if (!searchQuery) return sorted;
        return sorted.filter(s => s.displayName.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [sprays, ownedSpraySet, equippedSpraySet, searchQuery, showUnownedCosmetics]);

    const flexAssetMap = useMemo(() => {
        return new Map(flexes.map(flex => [flex.uuid.toLowerCase(), flex]));
    }, [flexes]);

    const activeSlot = SPRAY_SLOTS.find(s => s.id === modalSlotId);
    const activeFlexSlot = currentFlexes.find(slot => slot.typeId === modalFlexTypeId) || currentFlexes[0] || null;
    const activeFlexAsset = activeFlexSlot?.assetId
        ? flexAssetMap.get(activeFlexSlot.assetId.toLowerCase())
        : undefined;
    const pendingSprayAsset = pendingAssetId
        ? sprays.find(spray => spray.uuid.toLowerCase() === pendingAssetId.toLowerCase())
        : undefined;
    const pendingFlexAsset = pendingAssetId
        ? flexAssetMap.get(pendingAssetId.toLowerCase())
        : undefined;
    const modalOpen = Boolean(activeSlot) || modalFlexTypeId !== null;

    const displayFlexes = useMemo(() => {
        const equippedFlexSet = new Set(currentFlexes.map(slot => slot.assetId.toLowerCase()).filter(Boolean));
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
    }, [flexes, currentFlexes, searchQuery, showUnownedCosmetics]);

    const openSprayModal = (slotId: string) => {
        setModalSlotId(slotId);
        setModalFlexTypeId(null);
        setPendingAssetId(slotSprayMap[slotId]?.uuid || null);
        setActiveTab("sprays");
        setSearchQuery("");
    };

    const handleCloseModal = () => {
        setModalSlotId(null);
        setModalFlexTypeId(null);
        setPendingAssetId(null);
        setActiveTab("sprays");
        setSearchQuery("");
    };

    const handleApplySelection = () => {
        if (activeTab === "sprays" && modalSlotId) {
            const updated = currentSprays.filter(s => s.equipSlotId.toLowerCase() !== modalSlotId.toLowerCase());
            if (pendingAssetId) updated.push({ equipSlotId: modalSlotId, sprayId: pendingAssetId });
            onUpdateSprays(updated);
        } else if (activeFlexSlot && activeFlexSlot.typeId !== "pending-flex-slot" && onUpdateFlexes && pendingAssetId) {
            onUpdateFlexes(currentFlexes.map(slot =>
                slot.typeId.toLowerCase() === activeFlexSlot.typeId.toLowerCase()
                    ? { ...slot, assetId: pendingAssetId }
                    : slot,
            ));
        }
        handleCloseModal();
    };

    const switchTab = (tab: PickerTab) => {
        setActiveTab(tab);
        setSearchQuery("");
        if (tab === "sprays") {
            const slotId = modalSlotId || SPRAY_SLOTS[0].id;
            setModalSlotId(slotId);
            setModalFlexTypeId(null);
            setPendingAssetId(slotSprayMap[slotId]?.uuid || null);
        } else {
            setModalSlotId(null);
            const flexSlot = currentFlexes[0];
            setModalFlexTypeId(flexSlot?.typeId || "pending-flex-slot");
            setPendingAssetId(flexSlot?.assetId || null);
        }
    };

    return (
        <div className="cosmetics-panel-container">
            <div className="premium-spray-wheel-wrapper">
                <div className="cosmetics-sub-header">Expressions</div>
                <div className="circular-spray-wheel">
                    <div className="circular-spray-wheel-ring" />
                    <div className="circular-spray-wheel-center">Sprays</div>

                    {SPRAY_SLOTS.map(slot => {
                        const equipped = slotSprayMap[slot.id];
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
                                        <img src={equipped.icon} alt={equipped.name} loading="lazy" draggable={false} />
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
                                <span className="kicker">// Customize Expression</span>
                                <h3 className="unified-modal-title">{activeTab === "sprays" ? activeSlot?.name || "Sprays" : "Flex"}</h3>
                            </div>
                            <button type="button" className="unified-modal-close-btn" onClick={handleCloseModal} aria-label="Close">
                                x
                            </button>
                        </div>

                        <div className="unified-modal-content spray-picker-modal-content">
                            <div className="unified-modal-left spray-picker-modal-left">
                                <div className="unified-modal-preview-box spray-picker-modal-preview">
                                    <div className="unified-modal-card-tier-line" style={{ backgroundColor: "var(--accent)" }} />
                                    {activeTab === "sprays" && pendingSprayAsset ? (
                                        <img
                                            src={pendingSprayAsset.displayIcon || pendingSprayAsset.fullIcon || pendingSprayAsset.fullTransparentIcon}
                                            alt={pendingSprayAsset.displayName}
                                            className="unified-modal-preview-img"
                                            style={{ maxHeight: "70%", maxWidth: "70%", objectFit: "contain" }}
                                        />
                                    ) : activeTab === "flexes" && pendingFlexAsset?.displayIcon ? (
                                        <img
                                            src={pendingFlexAsset.displayIcon}
                                            alt={pendingFlexAsset.displayName}
                                            className="unified-modal-preview-img"
                                            style={{ maxHeight: "68%", maxWidth: "68%", objectFit: "contain" }}
                                        />
                                    ) : (
                                        <div className="spray-picker-empty" aria-label="Empty expression slot">-</div>
                                    )}
                                </div>

                                <div className="unified-modal-skin-meta">
                                    <h4>
                                        {activeTab === "sprays" && activeSlot
                                            ? pendingSprayAsset?.displayName || "Empty Slot"
                                            : pendingFlexAsset?.displayName || "No Flex Selected"}
                                    </h4>
                                    <span>
                                        {activeTab === "sprays"
                                            ? pendingSprayAsset ? "Selected — apply to keep" : "No spray selected"
                                            : currentFlexes.length > 0 ? "Selected — apply to keep" : "Flex slot not discovered from live loadout"}
                                    </span>
                                </div>

                                {activeTab === "flexes" && currentFlexes.length > 1 && (
                                    <div className="expression-flex-slot-switcher">
                                        {currentFlexes.map((slot, index) => (
                                            <button
                                                key={slot.typeId}
                                                type="button"
                                                className={slot.typeId === activeFlexSlot?.typeId ? "active" : ""}
                                                onClick={() => {
                                                    setModalFlexTypeId(slot.typeId);
                                                    setPendingAssetId(slot.assetId || null);
                                                }}
                                            >
                                                {index + 1}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                {activeTab === "sprays" && activeSlot && pendingAssetId && (
                                    <div className="spray-picker-clear-action">
                                        <button
                                            type="button"
                                            className="btn-tactical btn-tactical-ghost"
                                            onClick={() => setPendingAssetId(null)}
                                        >
                                            Clear Spray Slot
                                        </button>
                                    </div>
                                )}

                                {activeTab === "flexes" && activeFlexAsset && (
                                    <div className="spray-picker-clear-action">
                                        <button
                                            type="button"
                                            className="btn-tactical btn-tactical-ghost"
                                            onClick={() => {
                                                const noneFlex = flexes.find(flex => flex.displayName.toLowerCase() === "none");
                                                if (noneFlex) setPendingAssetId(noneFlex.uuid);
                                            }}
                                            disabled={!onUpdateFlexes || !activeFlexSlot || activeFlexSlot.typeId === "pending-flex-slot"}
                                        >
                                            Clear Flex
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
                                                                {isEquipped && <span className="unified-modal-card-status">Equipped</span>}
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
                                            {currentFlexes.length === 0 && (
                                                <div className="expression-slot-warning">
                                                    Flex catalog loaded. Equip unlocks once the live Riot loadout exposes a flex expression slot.
                                                </div>
                                            )}
                                            <div className="unified-modal-cards-grid expression-flex-grid">
                                                {displayFlexes.map(flex => {
                                                    const isEquipped = pendingAssetId?.toLowerCase() === flex.uuid.toLowerCase();
                                                    const canEquip = Boolean(onUpdateFlexes && activeFlexSlot && activeFlexSlot.typeId !== "pending-flex-slot");
                                                    return (
                                                        <button
                                                            key={flex.uuid}
                                                            type="button"
                                                            className={`unified-modal-card-item expression-flex-card${isEquipped ? " active" : ""}`}
                                                            onClick={() => setPendingAssetId(flex.uuid)}
                                                            title={flex.displayName}
                                                            disabled={!canEquip}
                                                        >
                                                            <div className="unified-modal-card-img-wrap expression-asset-img-wrap">
                                                                {flex.displayIcon ? (
                                                                    <img src={flex.displayIcon} alt="" style={{ objectFit: "contain" }} />
                                                                ) : (
                                                                    <span>-</span>
                                                                )}
                                                            </div>
                                                            <div className="unified-modal-card-info">
                                                                <span className="unified-modal-card-name">{flex.displayName}</span>
                                                                {isEquipped && <span className="unified-modal-card-status">Equipped</span>}
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
                                <strong>{activeTab === "sprays" ? pendingSprayAsset?.displayName || "Empty spray slot" : pendingFlexAsset?.displayName || "No flex selected"}</strong>
                                <span>The selection is kept only when you apply it.</span>
                            </div>
                            <div className="unified-modal-footer-actions">
                                <button type="button" className="btn-tactical btn-tactical-ghost" onClick={handleCloseModal}>Cancel</button>
                                <button
                                    type="button"
                                    className="btn-tactical btn-tactical-accent"
                                    onClick={handleApplySelection}
                                    disabled={activeTab === "flexes" && (!onUpdateFlexes || !activeFlexSlot || activeFlexSlot.typeId === "pending-flex-slot")}
                                >
                                    Apply {activeTab === "sprays" ? "Spray" : "Flex"}
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
