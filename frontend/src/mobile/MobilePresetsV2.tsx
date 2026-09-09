"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { applyLoadout, getPlayerLoadoutData, getPresets, savePresets } from "@/services/api";
import { exportPreset, importPreset } from "@/lib/presetShare";
import { buildPresetApplyRequest } from "@/lib/effectivePreset";
import { SPRAY_WHEEL_SLOTS as SPRAY_SLOTS } from "@/lib/spraySlots";
import type { Preset, Weapon } from "@/lib/types";
import {
  MobileBackHeader,
  MobileCosmeticEditorTarget,
  MobileDataLoading,
  MobileGameImage,
  MobileIcon,
  MobilePageHeader,
  MobileSectionHeader,
  MobileSheetLayer,
  MobileSprayWheel,
  skinForLoadout,
  skinRenderSources,
} from "./MobileKit";
import { MobileWeaponEditor } from "./MobileArsenalV2";

type PlayerLoadout = Awaited<ReturnType<typeof getPlayerLoadoutData>>;
type SheetMode = "create" | "rename" | "import" | "export" | "";
const CURRENT_PRESET_ID = "__current_loadout__";

function mergedPresetLoadout(preset: Preset, presets: Preset[]) {
  const parent = preset.parentUuid ? presets.find((item) => item.uuid === preset.parentUuid) : undefined;
  return { ...(parent?.loadout || {}), ...preset.loadout };
}

function LoadoutPreview({
  loadout,
  weapons,
}: {
  loadout: PlayerLoadout["loadout"];
  weapons: Weapon[];
}) {
  const priority = ["Vandal", "Phantom", "Operator", "Melee", "Sheriff", "Ghost"];
  const preview = Object.entries(loadout)
    .flatMap(([weaponId, item]) => {
      const weapon = weapons.find((candidate) => candidate.uuid === weaponId);
      return weapon ? [{ weapon, item }] : [];
    })
    .sort((left, right) => {
      const leftIndex = priority.indexOf(left.weapon.displayName);
      const rightIndex = priority.indexOf(right.weapon.displayName);
      return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    })
    .slice(0, 1);
  return (
    <div className="mv2-preset-preview">
      {preview.map(({ weapon, item }) => <MobileGameImage key={weapon.uuid} sources={skinRenderSources(weapon, item)} alt={weapon.displayName} />)}
      {!preview.length ? <MobileIcon name="presets" size={32} /> : null}
    </div>
  );
}

function PresetPreview({
  preset,
  presets,
  weapons,
}: {
  preset: Preset;
  presets: Preset[];
  weapons: Weapon[];
}) {
  return <LoadoutPreview loadout={mergedPresetLoadout(preset, presets)} weapons={weapons} />;
}

export default function MobilePresetsV2({
  initialEditor,
  onInitialEditorConsumed,
}: {
  initialEditor?: MobileCosmeticEditorTarget | null;
  onInitialEditorConsumed?: () => void;
}) {
  const {
    agents,
    ownedAgentIDs,
    ownedCardIDs,
    ownedSprayIDs,
    ownedTitleIDs,
    playerCards,
    playerTitles,
    sprays,
    weapons,
  } = useData();
  const [presets, setPresets] = useState<Preset[]>([]);
  const [current, setCurrent] = useState<PlayerLoadout | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Preset | null>(null);
  const [weaponEditorId, setWeaponEditorId] = useState("");
  const [sheet, setSheet] = useState<SheetMode>("");
  const [sheetValue, setSheetValue] = useState("");
  const [spraySlotId, setSpraySlotId] = useState("");
  const [sprayQuery, setSprayQuery] = useState("");
  const [spraySearchOpen, setSpraySearchOpen] = useState(false);
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [cardQuery, setCardQuery] = useState("");
  const [cardSearchOpen, setCardSearchOpen] = useState(false);
  const [titlePickerOpen, setTitlePickerOpen] = useState(false);
  const [titleQuery, setTitleQuery] = useState("");
  const [titleSearchOpen, setTitleSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState("refresh");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setBusy("refresh");
    setError("");
    const [presetResult, loadoutResult] = await Promise.allSettled([getPresets(), getPlayerLoadoutData()]);
    if (presetResult.status === "fulfilled") setPresets(presetResult.value);
    if (loadoutResult.status === "fulfilled") setCurrent(loadoutResult.value);
    const rejected = [presetResult, loadoutResult].find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") setError(rejected.reason instanceof Error ? rejected.reason.message : "Presets could not be loaded.");
    setBusy("");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const currentPreset = useMemo<Preset | null>(() => current ? {
    uuid: CURRENT_PRESET_ID,
    name: "Current loadout",
    loadout: { ...current.loadout },
    agents: [],
    identity: current.identity,
    sprays: [...(current.sprays || [])],
    flexes: [...(current.flexes || [])],
    expressions: [...(current.expressions || [])],
  } : null, [current]);
  const selected = selectedId === CURRENT_PRESET_ID
    ? currentPreset
    : presets.find((preset) => preset.uuid === selectedId) || null;
  const draftDirty = useMemo(() => {
    if (!draft || !selected) return false;
    const baseline = {
      loadout: mergedPresetLoadout(selected, presets),
      agents: selected.agents || [],
      identity: selected.identity,
      sprays: selected.sprays || [],
      flexes: selected.flexes || [],
      expressions: selected.expressions || [],
      disabled: Boolean(selected.disabled),
    };
    const changed = {
      loadout: draft.loadout,
      agents: draft.agents || [],
      identity: draft.identity,
      sprays: draft.sprays || [],
      flexes: draft.flexes || [],
      expressions: draft.expressions || [],
      disabled: Boolean(draft.disabled),
    };
    return JSON.stringify(changed) !== JSON.stringify(baseline);
  }, [draft, presets, selected]);
  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [selectedId, weaponEditorId]);

  useEffect(() => {
    if (!selected) {
      setDraft(null);
      return;
    }
    setDraft({ ...selected, loadout: mergedPresetLoadout(selected, presets), agents: [...(selected.agents || [])] });
  }, [presets, selected, selectedId]);

  useEffect(() => {
    if (!initialEditor || !currentPreset) return;
    setSelectedId(CURRENT_PRESET_ID);
  }, [currentPreset, initialEditor]);

  useEffect(() => {
    if (!initialEditor || draft?.uuid !== CURRENT_PRESET_ID) return;
    if (initialEditor.kind === "card") {
      setCardQuery("");
      setCardSearchOpen(false);
      setCardPickerOpen(true);
    } else {
      setSprayQuery("");
      setSpraySearchOpen(false);
      setSpraySlotId(initialEditor.slotId);
    }
    onInitialEditorConsumed?.();
  }, [draft?.uuid, initialEditor, onInitialEditorConsumed]);

  const persist = async (next: Preset[]) => {
    await savePresets(next);
    setPresets(next);
  };

  const flash = (value: string) => {
    setNotice(value);
    window.setTimeout(() => setNotice(""), 2400);
  };

  const applyPreset = async (preset: Preset) => {
    setBusy(`apply:${preset.uuid}`);
    setError("");
    try {
      await applyLoadout(buildPresetApplyRequest(preset, presets));
      const fresh = await getPlayerLoadoutData();
      setCurrent(fresh);
      flash(`${preset.name} applied.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preset could not be applied.");
    } finally {
      setBusy("");
    }
  };

  const saveDraft = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      const next = presets.map((preset) => preset.uuid === draft.uuid ? { ...draft, loadout: { ...draft.loadout } } : preset);
      await persist(next);
      flash("Preset changes saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preset could not be saved.");
    } finally {
      setBusy("");
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = sheetValue.trim();
    if (!name || !current) return;
    const nextPreset: Preset = {
      uuid: crypto.randomUUID(),
      name,
      loadout: { ...current.loadout },
      agents: [],
      identity: current.identity,
      sprays: [...(current.sprays || [])],
      flexes: [...(current.flexes || [])],
      expressions: [...(current.expressions || [])],
    };
    setBusy("sheet");
    try {
      await persist([...presets, nextPreset]);
      setSheet("");
      setSheetValue("");
      setSelectedId(nextPreset.uuid);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preset could not be created.");
    } finally {
      setBusy("");
    }
  };

  const rename = async (event: FormEvent) => {
    event.preventDefault();
    const name = sheetValue.trim();
    if (!draft || !name) return;
    setBusy("sheet");
    try {
      const changed = { ...draft, name };
      await persist(presets.map((item) => item.uuid === draft.uuid ? changed : item));
      setDraft(changed);
      setSheet("");
      setSheetValue("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preset could not be renamed.");
    } finally {
      setBusy("");
    }
  };

  const importCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("sheet");
    try {
      const imported = importPreset(sheetValue.trim());
      const next: Preset = { ...imported, uuid: crypto.randomUUID() };
      await persist([...presets, next]);
      setSheet("");
      setSheetValue("");
      setSelectedId(next.uuid);
      flash("Preset imported.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid preset code.");
    } finally {
      setBusy("");
    }
  };

  const duplicate = async (variant: boolean) => {
    if (!draft) return;
    const copy: Preset = {
      ...draft,
      uuid: crypto.randomUUID(),
      name: `${draft.name}${variant ? " Variant" : " Copy"}`,
      parentUuid: variant ? draft.uuid : undefined,
      loadout: { ...draft.loadout },
      agents: [...(draft.agents || [])],
    };
    await persist([...presets, copy]);
    setMenuOpen(false);
    setSelectedId(copy.uuid);
    flash(variant ? "Variant created." : "Preset duplicated.");
  };

  const remove = async () => {
    if (!draft) return;
    if (!window.confirm(`Delete "${draft.name}"?`)) return;
    setBusy("delete");
    try {
      await persist(presets.filter((item) => item.uuid !== draft.uuid && item.parentUuid !== draft.uuid));
      setSelectedId("");
      setMenuOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Preset could not be deleted.");
    } finally {
      setBusy("");
    }
  };

  const openExport = async () => {
    if (!draft) return;
    const code = exportPreset(draft);
    setSheetValue(code);
    setSheet("export");
    setMenuOpen(false);
    try {
      await navigator.clipboard.writeText(code);
      flash("Share code copied.");
    } catch {
      // The sheet still exposes the code for manual copy.
    }
  };

  const selectedWeapon = weapons.find((weapon) => weapon.uuid === weaponEditorId);
  if (draft && selectedWeapon && draft.loadout[selectedWeapon.uuid]) {
    return (
      <MobileWeaponEditor
        weapon={selectedWeapon}
        value={draft.loadout[selectedWeapon.uuid]}
        title={`${draft.name} · ${selectedWeapon.displayName}`}
        commitLabel="Keep in preset"
        onBack={() => setWeaponEditorId("")}
        onCommit={(item) => {
          setDraft((currentDraft) => currentDraft ? { ...currentDraft, loadout: { ...currentDraft.loadout, [selectedWeapon.uuid]: item } } : currentDraft);
          setWeaponEditorId("");
        }}
      />
    );
  }

  if (draft) {
    const editingCurrent = draft.uuid === CURRENT_PRESET_ID;
    const card = playerCards.find((item) => item.uuid.toLowerCase() === draft.identity?.playerCardId?.toLowerCase());
    const title = playerTitles.find((item) => item.uuid.toLowerCase() === draft.identity?.playerTitleId?.toLowerCase());
    const ownedCardSet = new Set(ownedCardIDs.map((id) => id.toLowerCase()));
    const ownedTitleSet = new Set(ownedTitleIDs.map((id) => id.toLowerCase()));
    const ownedAgentSet = new Set(ownedAgentIDs.map((id) => id.toLowerCase()));
    const availableCards = playerCards
      .filter((item) => ownedCardSet.has(item.uuid.toLowerCase()) || item.uuid.toLowerCase() === draft.identity?.playerCardId?.toLowerCase())
      .filter((item) => !cardQuery || item.displayName.toLowerCase().includes(cardQuery.toLowerCase()))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
    const availableTitles = playerTitles
      .filter((item) => ownedTitleSet.has(item.uuid.toLowerCase()) || item.uuid.toLowerCase() === draft.identity?.playerTitleId?.toLowerCase())
      .filter((item) => {
        const query = titleQuery.toLowerCase();
        return !query || item.displayName.toLowerCase().includes(query) || item.titleText.toLowerCase().includes(query);
      })
      .sort((left, right) => (left.titleText || left.displayName).localeCompare(right.titleText || right.displayName));
    const sprayCatalog = new Map(sprays.map((item) => [item.uuid.toLowerCase(), item]));
    const equippedSprayIds = new Set((draft.sprays || []).map((slot) => slot.sprayId.toLowerCase()));
    const ownedSpraySet = new Set(ownedSprayIDs.map((id) => id.toLowerCase()));
    const spraySlots = SPRAY_SLOTS.map((slot) => {
      const equipped = (draft.sprays || []).find((item) => item.equipSlotId.toLowerCase() === slot.id.toLowerCase());
      return { ...slot, equipped, spray: equipped ? sprayCatalog.get(equipped.sprayId.toLowerCase()) : undefined };
    });
    const activeSpraySlot = spraySlots.find((slot) => slot.id === spraySlotId);
    const availableSprays = sprays
      .filter((spray) => ownedSpraySet.has(spray.uuid.toLowerCase()) || equippedSprayIds.has(spray.uuid.toLowerCase()))
      .filter((spray) => !sprayQuery || spray.displayName.toLowerCase().includes(sprayQuery.toLowerCase()))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
    const chooseSpray = (sprayId?: string) => {
      const next = (draft.sprays || []).filter((slot) => slot.equipSlotId.toLowerCase() !== spraySlotId.toLowerCase());
      if (sprayId) next.push({ equipSlotId: spraySlotId, sprayId });
      setDraft({ ...draft, sprays: next });
      setSpraySlotId("");
      setSprayQuery("");
      setSpraySearchOpen(false);
    };
    const loadoutRows = Object.entries(draft.loadout)
      .flatMap(([weaponId, item]) => {
        const weapon = weapons.find((candidate) => candidate.uuid === weaponId);
        return weapon ? [{ weapon, item, skin: skinForLoadout(weapon, item) }] : [];
      })
      .sort((left, right) => left.weapon.displayName.localeCompare(right.weapon.displayName));
    return (
      <div className="mv2-preset-detail">
        <MobileBackHeader
          title={draft.name}
          detail={draftDirty ? "Unsaved changes" : editingCurrent ? "Equipped in VALORANT" : draft.parentUuid ? "Preset variant" : `${loadoutRows.length} weapon changes`}
          onBack={() => setSelectedId("")}
          action={editingCurrent ? undefined : <button type="button" className="mv2-header-action" onClick={() => setMenuOpen((value) => !value)}><MobileIcon name="more" /></button>}
        />
        {menuOpen && !editingCurrent ? (
          <div className="mv2-preset-menu">
            <button type="button" onClick={() => { setSheetValue(draft.name); setSheet("rename"); setMenuOpen(false); }}><MobileIcon name="edit" />Rename</button>
            <button type="button" onClick={() => void duplicate(false)}><MobileIcon name="presets" />Duplicate</button>
            <button type="button" onClick={() => void duplicate(true)}><MobileIcon name="plus" />Create variant</button>
            <button type="button" onClick={() => void openExport()}><MobileIcon name="upload" />Export</button>
            <button type="button" className="danger" onClick={() => void remove()}><MobileIcon name="close" />Delete</button>
          </div>
        ) : null}
        {error ? <div className="mv2-inline-error">{error}</div> : null}
        <PresetPreview preset={draft} presets={presets} weapons={weapons} />
        {!editingCurrent ? <>
        <label className="mv2-auto-preset">
          <span><strong>Agent auto-switch</strong><small>Allow this preset to be selected for assigned agents</small></span>
          <input type="checkbox" checked={!draft.disabled} onChange={(event) => setDraft({ ...draft, disabled: !event.target.checked })} />
        </label>

        <MobileSectionHeader title="Assigned agents" detail={`${draft.agents?.length || 0} selected`} />
        <div className="mv2-agent-picker">
          {agents.map((agent) => {
            const selectedAgent = draft.agents?.includes(agent.uuid);
            const ownedAgent = agent.isBaseContent || ownedAgentSet.has(agent.uuid.toLowerCase()) || selectedAgent;
            return (
              <button
                type="button"
                className={`${selectedAgent ? "selected" : ""}${ownedAgent ? "" : " locked"}`}
                key={agent.uuid}
                disabled={!ownedAgent}
                aria-label={ownedAgent ? agent.displayName : `${agent.displayName}, not owned`}
                onClick={() => setDraft({
                  ...draft,
                  agents: selectedAgent ? (draft.agents || []).filter((id) => id !== agent.uuid) : [...(draft.agents || []), agent.uuid],
                })}
              >
                <img src={agent.displayIcon} alt="" />
                <span>{agent.displayName}</span>
                {selectedAgent ? <i><MobileIcon name="check" size={12} /></i> : null}
                {!ownedAgent ? <i className="lock"><MobileIcon name="lock" size={11} /></i> : null}
              </button>
            );
          })}
        </div>
        </> : null}

        <MobileSectionHeader title="Weapons" detail="Tap a row to change skin, variant or buddy" />
        <div className="mv2-preset-weapons">
          {loadoutRows.map(({ weapon, item, skin }) => (
            <button type="button" key={weapon.uuid} onClick={() => setWeaponEditorId(weapon.uuid)}>
              <MobileGameImage sources={skinRenderSources(weapon, item)} alt={weapon.displayName} />
              <span><strong>{weapon.displayName}</strong><small>{skin?.displayName || "Standard"}</small></span>
              <MobileIcon name="chevron" size={19} />
            </button>
          ))}
        </div>

        <MobileSectionHeader title="Identity" detail="Player card and title saved with this preset" />
        <div className="mv2-preset-identity">
          {card ? (
            <button type="button" className="card" style={{ backgroundImage: `url(${card.wideArt || card.displayIcon})` }} onClick={() => { setCardPickerOpen(true); setCardQuery(""); setCardSearchOpen(false); }}>
              <strong>{card.displayName}</strong><small>Tap to change</small>
            </button>
          ) : (
            <button type="button" className="card empty" onClick={() => { setCardPickerOpen(true); setCardQuery(""); setCardSearchOpen(false); }}>Choose player card</button>
          )}
          <button type="button" className="title" onClick={() => { setTitlePickerOpen(true); setTitleQuery(""); setTitleSearchOpen(false); }}>
            <small>Player title</small>
            <strong>{title?.titleText || title?.displayName || "No title"}</strong>
            <span>Tap to change</span>
          </button>
          <button type="button" onClick={() => current && setDraft({
            ...draft,
            identity: current.identity,
          })}>Use current identity</button>
        </div>

        <MobileSectionHeader title="Sprays" detail={`${spraySlots.filter((slot) => slot.spray).length} / ${SPRAY_SLOTS.length} slots`} />
        <div className="mv2-preset-spray-wheel-wrap">
          <MobileSprayWheel
            slots={spraySlots}
            onSelect={(slot) => {
              setSpraySlotId(slot.id);
              setSprayQuery("");
              setSpraySearchOpen(false);
            }}
          />
          <p>Tap any part of the wheel to choose that spray.</p>
        </div>
        <button type="button" className="mv2-preset-use-current" onClick={() => current && setDraft({
          ...draft,
          sprays: [...(current.sprays || [])],
            flexes: [...(current.flexes || [])],
            expressions: [...(current.expressions || [])],
        })}>Use current sprays</button>

        <div className={`mv2-sticky-actions${editingCurrent ? "" : " split"}`}>
          {!editingCurrent ? <button type="button" onClick={() => void saveDraft()} disabled={busy === "save" || !draftDirty}>{busy === "save" ? "Saving…" : draftDirty ? "Save changes" : "Saved"}</button> : null}
          <button type="button" className="mv2-primary" onClick={() => void applyPreset(draft)} disabled={busy.startsWith("apply:") || (editingCurrent && !draftDirty)}>{busy.startsWith("apply:") ? "Applying…" : editingCurrent ? draftDirty ? "Apply current loadout changes" : "No changes" : "Apply preset"}</button>
        </div>
        {cardPickerOpen ? (
          <MobileSheetLayer onClose={() => { setCardPickerOpen(false); setCardSearchOpen(false); setCardQuery(""); }}>
            <div className="mv2-sheet mv2-card-picker-sheet" onClick={(event) => event.stopPropagation()}>
              <i />
              <header className="mv2-picker-heading">
                <h2>Player card</h2>
                <button type="button" data-active={cardSearchOpen} onClick={() => { setCardSearchOpen((value) => !value); if (cardSearchOpen) setCardQuery(""); }} aria-label={cardSearchOpen ? "Hide card search" : "Search player cards"}><MobileIcon name={cardSearchOpen ? "close" : "search"} size={19} /></button>
              </header>
              <p>Choose one of the cards owned by this account.</p>
              {cardSearchOpen ? <input autoFocus value={cardQuery} onChange={(event) => setCardQuery(event.target.value)} placeholder="Search cards" /> : null}
              <div className="mv2-card-picker-grid">
                {availableCards.map((item) => {
                  const selectedCard = item.uuid.toLowerCase() === draft.identity?.playerCardId?.toLowerCase();
                  return (
                    <button type="button" className={selectedCard ? "selected" : ""} key={item.uuid} onClick={() => {
                      setDraft({
                        ...draft,
                        identity: {
                          ...(draft.identity || { playerCardId: "", playerTitleId: "" }),
                          playerCardId: item.uuid,
                        },
                      });
                      setCardPickerOpen(false);
                      setCardQuery("");
                      setCardSearchOpen(false);
                    }}>
                      <span><img src={item.wideArt || item.displayIcon} alt="" loading="lazy" /></span>
                      <small>{item.displayName}</small>
                      {selectedCard ? <i><MobileIcon name="check" size={11} /></i> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </MobileSheetLayer>
        ) : null}
        {titlePickerOpen ? (
          <MobileSheetLayer onClose={() => { setTitlePickerOpen(false); setTitleSearchOpen(false); setTitleQuery(""); }}>
            <div className="mv2-sheet mv2-title-picker-sheet" onClick={(event) => event.stopPropagation()}>
              <i />
              <header className="mv2-picker-heading">
                <h2>Player title</h2>
                <button type="button" data-active={titleSearchOpen} onClick={() => { setTitleSearchOpen((value) => !value); if (titleSearchOpen) setTitleQuery(""); }} aria-label={titleSearchOpen ? "Hide title search" : "Search player titles"}><MobileIcon name={titleSearchOpen ? "close" : "search"} size={19} /></button>
              </header>
              <p>Choose one of the titles owned by this account.</p>
              {titleSearchOpen ? <input autoFocus value={titleQuery} onChange={(event) => setTitleQuery(event.target.value)} placeholder="Search titles" /> : null}
              <div className="mv2-title-picker-list">
                {availableTitles.map((item) => {
                  const selectedTitle = item.uuid.toLowerCase() === draft.identity?.playerTitleId?.toLowerCase();
                  return (
                    <button type="button" className={selectedTitle ? "selected" : ""} key={item.uuid} onClick={() => {
                      setDraft({
                        ...draft,
                        identity: {
                          ...(draft.identity || { playerCardId: "", playerTitleId: "" }),
                          playerTitleId: item.uuid,
                        },
                      });
                      setTitlePickerOpen(false);
                      setTitleQuery("");
                      setTitleSearchOpen(false);
                    }}>
                      <span><strong>{item.titleText || "No title"}</strong><small>{item.displayName}</small></span>
                      {selectedTitle ? <i><MobileIcon name="check" size={12} /></i> : <MobileIcon name="chevron" size={18} />}
                    </button>
                  );
                })}
                {!availableTitles.length ? <div className="mv2-picker-empty">No owned titles match this search.</div> : null}
              </div>
            </div>
          </MobileSheetLayer>
        ) : null}
        {activeSpraySlot ? (
          <MobileSheetLayer onClose={() => { setSpraySlotId(""); setSpraySearchOpen(false); setSprayQuery(""); }}>
            <div className="mv2-sheet mv2-spray-picker-sheet" onClick={(event) => event.stopPropagation()}>
              <i />
              <header className="mv2-picker-heading">
                <h2>{activeSpraySlot.name} spray</h2>
                <button type="button" data-active={spraySearchOpen} onClick={() => { setSpraySearchOpen((value) => !value); if (spraySearchOpen) setSprayQuery(""); }} aria-label={spraySearchOpen ? "Hide spray search" : "Search sprays"}><MobileIcon name={spraySearchOpen ? "close" : "search"} size={19} /></button>
              </header>
              <p>Choose one of the sprays owned by this account.</p>
              {spraySearchOpen ? <input autoFocus value={sprayQuery} onChange={(event) => setSprayQuery(event.target.value)} placeholder="Search sprays" /> : null}
              <div className="mv2-spray-picker-grid">
                <button type="button" className={!activeSpraySlot.spray ? "selected" : ""} onClick={() => chooseSpray()}>
                  <span><MobileIcon name="close" /></span>
                  <small>Empty slot</small>
                </button>
                {availableSprays.map((spray) => {
                  const selectedSpray = activeSpraySlot.spray?.uuid.toLowerCase() === spray.uuid.toLowerCase();
                  return (
                    <button type="button" className={selectedSpray ? "selected" : ""} key={spray.uuid} onClick={() => chooseSpray(spray.uuid)}>
                      <span><img src={spray.fullTransparentIcon || spray.fullIcon || spray.displayIcon} alt="" loading="lazy" /></span>
                      <small>{spray.displayName}</small>
                      {selectedSpray ? <i><MobileIcon name="check" size={11} /></i> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          </MobileSheetLayer>
        ) : null}
      </div>
    );
  }

  if (busy === "refresh" && !current) {
    return (
      <div className="mv2-presets">
        <MobilePageHeader title="Presets" subtitle="Saved loadouts and agent assignments" />
        <MobileDataLoading
          kind="presets"
          title="Preparing your presets"
          detail="Loading the current baseline and your saved loadouts."
        />
      </div>
    );
  }

  return (
    <div className="mv2-presets">
      <MobilePageHeader
        title="Presets"
        subtitle={`${presets.length} saved loadout${presets.length === 1 ? "" : "s"}`}
        action={<span className="mv2-preset-header-actions"><button type="button" onClick={() => { setSheetValue(""); setSheet("import"); }} aria-label="Import preset"><MobileIcon name="download" /></button><button type="button" onClick={() => { setSheetValue(""); setSheet("create"); }} aria-label="Create preset"><MobileIcon name="plus" /></button></span>}
      />
      {error ? <div className="mv2-inline-error">{error}</div> : null}
      {current ? (
        <>
          <MobileSectionHeader title="Current loadout" detail="Equipped in VALORANT" />
          <div className="mv2-preset-list mv2-current-preset-list">
            <article className="mv2-current-preset">
              <div className="mv2-preset-open mv2-preset-open-static">
                <LoadoutPreview loadout={current.loadout} weapons={weapons} />
                <span>
                  <strong>Current loadout</strong>
                  <small>Your live baseline · {Object.keys(current.loadout).length} weapons</small>
                </span>
                <i className="mv2-current-badge"><MobileIcon name="check" size={12} /> Equipped</i>
              </div>
              <div className="mv2-preset-card-actions current">
                <button type="button" onClick={() => setSelectedId(CURRENT_PRESET_ID)}><MobileIcon name="edit" size={16} />Edit loadout</button>
                <button type="button" className="primary" onClick={() => { setSheetValue(""); setSheet("create"); }}><MobileIcon name="plus" size={16} />Save as preset</button>
              </div>
            </article>
          </div>
        </>
      ) : null}
      <MobileSectionHeader title="Saved presets" detail={`${presets.length} saved`} />
      <div className="mv2-preset-list">
        {presets.map((preset) => (
          <article key={preset.uuid}>
            <button type="button" className="mv2-preset-open" onClick={() => setSelectedId(preset.uuid)}>
              <PresetPreview preset={preset} presets={presets} weapons={weapons} />
              <span>
                <strong>{preset.name}</strong>
                <small>{preset.parentUuid ? "Variant · " : ""}{Object.keys(mergedPresetLoadout(preset, presets)).length} weapons · {preset.agents?.length || 0} agents</small>
              </span>
            </button>
            <div className="mv2-preset-card-actions">
              <button type="button" onClick={() => setSelectedId(preset.uuid)}><MobileIcon name="edit" size={16} />Edit preset</button>
              <button type="button" className="primary" onClick={() => void applyPreset(preset)} disabled={busy === `apply:${preset.uuid}`}>
              {busy === `apply:${preset.uuid}` ? "Applying…" : "Apply"}
              </button>
            </div>
          </article>
        ))}
        {!presets.length && busy !== "refresh" ? (
          <div className="mv2-empty mv2-preset-empty-compact">
            <MobileIcon name="presets" size={34} />
            <h2>No saved presets yet</h2>
            <p>Your current loadout stays above as the baseline. Save it when you want a reusable copy.</p>
            <button type="button" className="mv2-primary" onClick={() => { setSheetValue(""); setSheet("create"); }}>Create preset</button>
          </div>
        ) : null}
      </div>
      {notice ? <div className="mv2-toast">{notice}</div> : null}

      {sheet ? (
        <MobileSheetLayer onClose={() => setSheet("")}>
          <form className="mv2-sheet" onSubmit={sheet === "create" ? create : sheet === "rename" ? rename : sheet === "import" ? importCode : (event) => event.preventDefault()} onClick={(event) => event.stopPropagation()}>
            <i />
            <header className="mv2-sheet-heading">
              <h2>{sheet === "create" ? "Create preset" : sheet === "rename" ? "Rename preset" : sheet === "import" ? "Import preset" : "Export preset"}</h2>
              <button type="button" onClick={() => setSheet("")} aria-label="Close preset dialog"><MobileIcon name="close" /></button>
            </header>
            <p>{sheet === "export" ? "This share code includes the preset loadout, agents, identity, sprays and flexes." : sheet === "import" ? "Paste a VantaVault preset share code." : "Choose a clear name for this loadout."}</p>
            {sheet === "import" || sheet === "export" ? (
              <textarea autoFocus={sheet === "import"} readOnly={sheet === "export"} value={sheetValue} onChange={(event) => setSheetValue(event.target.value)} />
            ) : (
              <label>Preset name<input autoFocus value={sheetValue} onChange={(event) => setSheetValue(event.target.value)} maxLength={48} /></label>
            )}
            {sheet === "export" ? (
              <button type="button" className="mv2-primary" onClick={async () => { await navigator.clipboard.writeText(sheetValue); flash("Share code copied."); setSheet(""); }}>Copy share code</button>
            ) : (
              <button type="submit" className="mv2-primary" disabled={!sheetValue.trim() || busy === "sheet"}>{busy === "sheet" ? "Saving…" : sheet === "import" ? "Import preset" : "Save"}</button>
            )}
          </form>
        </MobileSheetLayer>
      ) : null}
    </div>
  );
}
