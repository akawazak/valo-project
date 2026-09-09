"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import { applyLoadout, getPlayerLoadoutData } from "@/services/api";
import type { Chroma, GunBuddy, LoadoutItemV1, Skin, Weapon } from "@/lib/types";
import {
  MobileBackHeader,
  MobileDataLoading,
  MobileErrorNotice,
  MobileGameImage,
  MobileIcon,
  MobilePageHeader,
  MobileSectionHeader,
  buddyForLoadout,
  chromaForLoadout,
  skinForLoadout,
  skinRenderSources,
} from "./MobileKit";

function ownedSkinLevel(skin: Skin, ownedLevelIDs: string[]) {
  const owned = new Set(ownedLevelIDs.map((id) => id.toLowerCase()));
  return [...skin.levels].reverse().find((level) => owned.has(level.uuid.toLowerCase())) || skin.levels[skin.levels.length - 1];
}

function ownedChromas(skin: Skin, ownedChromaIDs: string[]) {
  const owned = new Set(ownedChromaIDs.map((id) => id.toLowerCase()));
  return skin.chromas.filter((chroma, index) => index === 0 || owned.has(chroma.uuid.toLowerCase()));
}

function ownedBuddyLevel(buddy: GunBuddy, ownedBuddyIDs: Array<{ levelId: string }>) {
  const owned = new Set(ownedBuddyIDs.map((item) => item.levelId.toLowerCase()));
  return buddy.levels.find((level) => owned.has(level.uuid.toLowerCase()));
}

export function MobileWeaponEditor({
  weapon,
  value,
  title,
  commitLabel,
  onBack,
  onCommit,
}: {
  weapon: Weapon;
  value: LoadoutItemV1;
  title?: string;
  commitLabel: string;
  onBack: () => void;
  onCommit: (value: LoadoutItemV1) => Promise<void> | void;
}) {
  const { allBuddies, ownedBuddyIDs, ownedChromaIDs, ownedLevelIDs } = useData();
  const [draft, setDraft] = useState<LoadoutItemV1>(value);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(value);
    setSaved(false);
  }, [value, weapon.uuid]);

  const ownedLevels = useMemo(() => new Set(ownedLevelIDs.map((id) => id.toLowerCase())), [ownedLevelIDs]);
  const skins = useMemo(
    () => weapon.skins.filter((skin) => skin.uuid === weapon.defaultSkinUuid || skin.levels.some((level) => ownedLevels.has(level.uuid.toLowerCase()))),
    [ownedLevels, weapon],
  );
  const selectedSkin = skinForLoadout(weapon, draft) || skins[0];
  const selectedChroma = chromaForLoadout(selectedSkin, draft) || selectedSkin?.chromas[0];
  const variants = selectedSkin ? ownedChromas(selectedSkin, ownedChromaIDs) : [];
  const selectedBuddy = buddyForLoadout(allBuddies, draft);
  const buddies = useMemo(
    () => allBuddies.filter((buddy) => Boolean(ownedBuddyLevel(buddy, ownedBuddyIDs))),
    [allBuddies, ownedBuddyIDs],
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(value);

  const chooseSkin = (skin: Skin) => {
    const level = ownedSkinLevel(skin, ownedLevelIDs);
    const chromas = ownedChromas(skin, ownedChromaIDs);
    const chroma = chromas[0] || skin.chromas[0];
    setSaved(false);
    setDraft((current) => ({
      ...current,
      skinId: skin.uuid,
      skinLevelId: level?.uuid || current.skinLevelId,
      chromaId: chroma?.uuid || current.chromaId,
    }));
  };

  const chooseChroma = (chroma: Chroma) => {
    setSaved(false);
    setDraft((current) => ({ ...current, chromaId: chroma.uuid }));
  };

  const chooseBuddy = (buddy: GunBuddy) => {
    const level = ownedBuddyLevel(buddy, ownedBuddyIDs);
    if (!level) return;
    setSaved(false);
    setDraft((current) => ({ ...current, charmID: buddy.uuid, charmLevelID: level.uuid }));
  };

  const commit = async () => {
    setBusy(true);
    setError("");
    try {
      await onCommit(draft);
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this weapon.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mv2-weapon-editor">
      <MobileBackHeader title={title || weapon.displayName} detail="Skin, variant and buddy" onBack={onBack} />
      {error ? <div className="mv2-inline-error">{error}</div> : null}
      <section className="mv2-weapon-hero">
        <MobileGameImage sources={skinRenderSources(weapon, draft)} alt={selectedSkin?.displayName || weapon.displayName} />
        <div className="mv2-weapon-meta">
          <small>Selected loadout</small>
          <strong>{selectedSkin?.displayName || "Standard"}</strong>
          <span>{selectedChroma?.displayName || "Default variant"}{selectedBuddy ? ` · ${selectedBuddy.displayName}` : ""}</span>
          {saved && !dirty ? <i><MobileIcon name="check" size={16} /> Applied</i> : dirty ? <i className="pending">Not applied</i> : <i>Equipped</i>}
        </div>
        {variants.length > 1 ? (
          <div className="mv2-hero-variants">
            <small>Variant</small>
            <div className="mv2-variant-rail">
              {variants.map((chroma, index) => {
                const selected = chroma.uuid.toLowerCase() === draft.chromaId?.toLowerCase();
                return (
                  <button type="button" className={selected ? "selected" : ""} key={chroma.uuid} onClick={() => chooseChroma(chroma)}>
                    <span style={chroma.swatch ? { backgroundImage: `url(${chroma.swatch})` } : undefined}>
                      <MobileGameImage sources={[chroma.displayIcon, chroma.fullRender]} alt={chroma.displayName} />
                    </span>
                    <strong>{chroma.displayName || `Variant ${index + 1}`}</strong>
                    {selected ? <i><MobileIcon name="check" size={11} /></i> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <MobileSectionHeader title="Skins" detail={`${skins.length} owned`} />
      <div className="mv2-skin-grid">
        {skins.map((skin) => {
          const selected = skin.uuid === selectedSkin?.uuid;
          const chroma = ownedChromas(skin, ownedChromaIDs)[0] || skin.chromas[0];
          return (
            <button type="button" className={selected ? "selected" : ""} key={skin.uuid} onClick={() => chooseSkin(skin)}>
              <MobileGameImage sources={skinRenderSources(weapon, draft, skin, chroma)} alt={skin.displayName} />
              <span>{skin.displayName}</span>
              {selected ? <i><MobileIcon name="check" size={13} /> Selected</i> : null}
            </button>
          );
        })}
      </div>

      <MobileSectionHeader title="Gun buddy" detail={selectedBuddy?.displayName || "None selected"} />
      <div className="mv2-buddy-rail">
        <button type="button" className={!selectedBuddy ? "selected" : ""} onClick={() => {
          setSaved(false);
          setDraft((current) => ({ ...current, charmID: undefined, charmLevelID: undefined }));
        }}>
          <span><MobileIcon name="close" /></span><strong>None</strong>
        </button>
        {buddies.map((buddy) => {
          const selected = buddy.uuid === selectedBuddy?.uuid;
          const level = ownedBuddyLevel(buddy, ownedBuddyIDs);
          return (
            <button type="button" className={selected ? "selected" : ""} key={buddy.uuid} onClick={() => chooseBuddy(buddy)}>
              <span>{level?.displayIcon ? <img src={level.displayIcon} alt="" /> : null}</span>
              <strong>{buddy.displayName}</strong>
            </button>
          );
        })}
      </div>

      <div className="mv2-sticky-actions">
        <button type="button" className="mv2-primary" onClick={() => void commit()} disabled={busy || (!dirty && !saved)}>
          {busy ? "Applying…" : saved && !dirty ? "Applied" : commitLabel}
        </button>
      </div>
    </div>
  );
}

export default function MobileArsenalV2() {
  const { weapons } = useData();
  const [loadout, setLoadout] = useState<Record<string, LoadoutItemV1>>({});
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getPlayerLoadoutData();
      setLoadout(next.loadout);
    } catch (reason) {
      setError(reason);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected = weapons.find((weapon) => weapon.uuid === selectedId);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [selectedId]);

  const groups = useMemo(() => {
    const labels: Record<string, string> = { Sidearm: "Sidearms", SMG: "SMGs", Shotgun: "Shotguns", Rifle: "Rifles", Sniper: "Snipers", Heavy: "Heavy", Melee: "Melee" };
    const order = ["Sidearm", "SMG", "Shotgun", "Rifle", "Sniper", "Heavy", "Melee"];
    const map = new Map<string, Weapon[]>();
    for (const weapon of weapons) {
      const key = weapon.category?.split("::").pop() || "Other";
      map.set(key, [...(map.get(key) || []), weapon]);
    }
    return [...map.entries()]
      .sort(([left], [right]) => (order.indexOf(left) < 0 ? 99 : order.indexOf(left)) - (order.indexOf(right) < 0 ? 99 : order.indexOf(right)))
      .map(([key, items]) => ({ key, label: labels[key] || key, items }));
  }, [weapons]);

  if (selected && loadout[selected.uuid]) {
    return (
      <MobileWeaponEditor
        weapon={selected}
        value={loadout[selected.uuid]}
        commitLabel="Apply weapon"
        onBack={() => setSelectedId("")}
        onCommit={async (next) => {
          await applyLoadout({ loadout: { [selected.uuid]: next } });
          setLoadout((current) => ({ ...current, [selected.uuid]: next }));
        }}
      />
    );
  }

  if (loading && !Object.keys(loadout).length) {
    return (
      <div className="mv2-arsenal">
        <MobilePageHeader title="Arsenal" subtitle="Your equipped weapons and cosmetics" />
        <MobileDataLoading
          kind="arsenal"
          title="Equipping your Arsenal"
          detail="Matching every weapon with its skin, variant and buddy."
        />
      </div>
    );
  }

  return (
    <div className="mv2-arsenal">
      <MobilePageHeader title="Arsenal" subtitle="Your equipped weapons and cosmetics" action={<MobileIcon name="refresh" />} actionLabel="Refresh Arsenal" onAction={() => void refresh()} />
      {error ? <MobileErrorNotice error={error} onRetry={() => void refresh()} onDismiss={() => setError(null)} /> : null}
      {groups.map((group) => (
        <section key={group.key}>
          <MobileSectionHeader title={group.label} />
          <div className="mv2-weapon-grid">
            {group.items.map((weapon) => {
              const item = loadout[weapon.uuid];
              const skin = skinForLoadout(weapon, item);
              const chroma = chromaForLoadout(skin, item);
              return (
                <button type="button" key={weapon.uuid} onClick={() => setSelectedId(weapon.uuid)} disabled={!item}>
                  <MobileGameImage sources={skinRenderSources(weapon, item)} alt={weapon.displayName} />
                  <span><strong>{weapon.displayName}</strong><small>{skin?.displayName || (loading ? "Loading…" : "Standard")}</small>{chroma && chroma !== skin?.chromas[0] ? <i>{chroma.displayName}</i> : null}</span>
                  <MobileIcon name="chevron" size={18} />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
