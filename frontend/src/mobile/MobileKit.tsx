"use client";

import { CSSProperties, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { fetchCachedPublicJson } from "@/services/api";
import { toAppErrorInfo } from "@/lib/errors";
import type {
  Chroma,
  ContentTier,
  GunBuddy,
  LoadoutItemV1,
  Skin,
  SprayAsset,
  StorefrontOffer,
  Weapon,
} from "@/lib/types";

export type MobileTab = "home" | "arsenal" | "presets" | "social" | "profile";
export type MobileCosmeticEditorTarget =
  | { kind: "card" }
  | { kind: "spray"; slotId: string };

export type MobileIconName =
  | MobileTab
  | "back"
  | "chevron"
  | "check"
  | "close"
  | "download"
  | "edit"
  | "lock"
  | "message"
  | "more"
  | "party"
  | "plus"
  | "refresh"
  | "search"
  | "send"
  | "settings"
  | "store"
  | "upload";

export function MobileIcon({ name, size = 24 }: { name: MobileIconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  const paths: Record<MobileIconName, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
    arsenal: <><path d="M3 9.5h10.5l2.7-2.7 4 1.2-2 3.5 2.2 1.6-1.4 2.2-4-1.5-2 1.7H8l-2.4 3H3.2l1.2-4H3z" /><path d="M8 9.5 6.5 6H4" /></>,
    presets: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" /></>,
    social: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    check: <path d="m5 12 4 4L19 6" />,
    close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
    download: <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>,
    edit: <><path d="m4 16-1 5 5-1L19 9l-4-4z" /><path d="m13 7 4 4" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    message: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    party: <><circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M2.5 20a5.5 5.5 0 0 1 11 0" /><path d="M13 16a4.5 4.5 0 0 1 8.5 2" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.36.37.7.66.98.29.27.66.42 1.06.42H21v4h-.09a1.7 1.7 0 0 0-1.51.6Z" /></>,
    store: <><path d="M4 9h16l-1-5H5z" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 21h14" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

export type MobileSprayWheelSlot = {
  id: string;
  name: string;
  spray?: SprayAsset;
};

export function MobileSprayWheel({
  slots,
  onSelect,
  compact = false,
}: {
  slots: MobileSprayWheelSlot[];
  onSelect?: (slot: MobileSprayWheelSlot) => void;
  compact?: boolean;
}) {
  const positions = ["top", "right", "bottom", "left"] as const;
  return (
    <div className={`mv2-spray-wheel${compact ? " compact" : ""}${onSelect ? " editable" : ""}`}>
      {positions.map((position, index) => {
        const slot = slots[index];
        if (!slot) return <span className={`mv2-spray-wheel-slot ${position}`} key={position} />;
        const icon = slot.spray?.fullTransparentIcon || slot.spray?.fullIcon || slot.spray?.displayIcon;
        const Component = onSelect ? "button" : "span";
        return (
          <Component
            className={`mv2-spray-wheel-slot ${position}${slot.spray ? " equipped" : " empty"}`}
            key={slot.id}
            {...(onSelect ? { type: "button" as const, onClick: () => onSelect(slot) } : {})}
            aria-label={`${slot.name}: ${slot.spray?.displayName || "empty"}`}
            title={`${slot.name}: ${slot.spray?.displayName || "Empty"}`}
          >
            {icon ? <img src={icon} alt="" /> : <MobileIcon name="plus" size={compact ? 18 : 23} />}
            <small>{slot.name}</small>
          </Component>
        );
      })}
      <i aria-hidden="true" />
    </div>
  );
}

export function MobileGameImage({
  sources,
  alt = "",
  className,
}: {
  sources: Array<string | null | undefined>;
  alt?: string;
  className?: string;
}) {
  const usable = useMemo(
    () => Array.from(new Set(sources.filter((source): source is string => Boolean(source)))),
    [sources],
  );
  const sourceKey = usable.join("|");
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [sourceKey]);
  if (!usable[index]) {
    return (
      <span className={`mv2-image-placeholder ${className || ""}`} aria-label={alt}>
        <MobileIcon name="arsenal" />
      </span>
    );
  }
  return (
    <img
      className={`${className || ""} ${loaded ? "" : "mv2-image-loading"}`}
      src={usable[index]}
      alt={alt}
      onLoad={() => setLoaded(true)}
      onError={() => {
        setLoaded(false);
        setIndex((value) => value + 1);
      }}
    />
  );
}

export function MobileSheetLayer({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    let sheet: HTMLElement | null = null;
    let startY = 0;
    let currentY = 0;
    let startedAt = 0;
    let dragging = false;
    let blockingBackdrop = false;

    const resetSheet = () => {
      if (!sheet) return;
      sheet.style.transition = "transform 180ms cubic-bezier(.2,.8,.2,1)";
      sheet.style.transform = "";
      layer.style.opacity = "";
      window.setTimeout(() => {
        if (sheet) sheet.style.transition = "";
      }, 190);
    };

    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const target = event.target instanceof Element ? event.target : null;
      sheet = target?.closest<HTMLElement>(".mv2-sheet") || null;
      blockingBackdrop = !sheet;
      if (!sheet || sheet.scrollTop > 1) {
        sheet = null;
        return;
      }
      const nestedScroller = target?.closest<HTMLElement>(".mv2-title-picker-list, .mv2-card-picker-grid, .mv2-spray-picker-grid");
      if (nestedScroller && nestedScroller.scrollTop > 1) {
        sheet = null;
        return;
      }
      startY = event.touches[0].clientY;
      currentY = startY;
      startedAt = performance.now();
      dragging = false;
    };

    const touchMove = (event: TouchEvent) => {
      if (blockingBackdrop) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      if (!sheet || event.touches.length !== 1) return;
      currentY = event.touches[0].clientY;
      const distance = currentY - startY;
      if (distance <= 4) return;
      if (sheet.scrollTop > 1) {
        sheet = null;
        return;
      }
      dragging = true;
      suppressClick.current = true;
      if (event.cancelable) event.preventDefault();
      const translated = Math.min(distance * 0.92, window.innerHeight);
      sheet.style.transition = "none";
      sheet.style.transform = `translate3d(0, ${translated}px, 0)`;
      layer.style.opacity = `${Math.max(0.42, 1 - translated / window.innerHeight)}`;
    };

    const touchEnd = () => {
      blockingBackdrop = false;
      if (!sheet || !dragging) {
        sheet = null;
        return;
      }
      const distance = Math.max(0, currentY - startY);
      const velocity = distance / Math.max(1, performance.now() - startedAt);
      const shouldClose = distance >= Math.min(140, sheet.clientHeight * 0.2)
        || (distance >= 44 && velocity > 0.65);
      if (shouldClose) {
        sheet.style.transition = "transform 170ms cubic-bezier(.4,0,1,1)";
        sheet.style.transform = "translate3d(0, 105%, 0)";
        layer.style.opacity = "0";
        closeTimer.current = window.setTimeout(() => onCloseRef.current(), 170);
      } else {
        resetSheet();
      }
      sheet = null;
      dragging = false;
    };

    layer.addEventListener("touchstart", touchStart, { passive: true });
    layer.addEventListener("touchmove", touchMove, { passive: false });
    layer.addEventListener("touchend", touchEnd, { passive: true });
    layer.addEventListener("touchcancel", touchEnd, { passive: true });
    return () => {
      layer.removeEventListener("touchstart", touchStart);
      layer.removeEventListener("touchmove", touchMove);
      layer.removeEventListener("touchend", touchEnd);
      layer.removeEventListener("touchcancel", touchEnd);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div
      ref={layerRef}
      className="mv2-sheet-layer"
      onClick={() => onCloseRef.current()}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }}
    >
      {children}
    </div>
  );
}

export function MobilePageHeader({
  title,
  subtitle,
  action,
  actionLabel,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <header className="mv2-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? (onAction ? (
        <button type="button" onClick={onAction} aria-label={actionLabel} title={actionLabel}>
          {action}
        </button>
      ) : action) : null}
    </header>
  );
}

export function MobileBackHeader({
  title,
  detail,
  onBack,
  action,
}: {
  title: string;
  detail?: string;
  onBack: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="mv2-back-header">
      <button type="button" onClick={onBack} aria-label="Go back"><MobileIcon name="back" /></button>
      <div><h1>{title}</h1>{detail ? <p>{detail}</p> : null}</div>
      {action || <span />}
    </header>
  );
}

export function MobileSectionHeader({
  title,
  detail,
  action,
  onAction,
}: {
  title: string;
  detail?: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mv2-section-header">
      <div><h2>{title}</h2>{detail ? <span>{detail}</span> : null}</div>
      {action && onAction ? <button type="button" onClick={onAction}>{action}<MobileIcon name="chevron" size={17} /></button> : null}
    </div>
  );
}

export function MobileErrorNotice({
  error,
  onRetry,
  onDismiss,
}: {
  error: unknown;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const info = toAppErrorInfo(error);
  const technical = [
    `Code: ${info.code}`,
    info.status ? `HTTP: ${info.status}` : "",
    `Message: ${info.message}`,
    info.details ? `Details: ${info.details}` : "",
  ].filter(Boolean).join("\n");

  const copyDetails = async () => {
    await navigator.clipboard?.writeText(technical).catch(() => undefined);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <>
      <aside className="mv2-error-notice" role="alert">
        <span><MobileIcon name="more" size={20} /></span>
        <div><strong>{info.title}</strong><p>{info.message}</p><small>{info.code}</small></div>
        <nav>
          {onRetry && info.retryable ? <button type="button" onClick={onRetry}>Retry</button> : null}
          <button type="button" onClick={() => setDetailsOpen(true)}>Details</button>
          {onDismiss ? <button type="button" aria-label="Dismiss error" onClick={onDismiss}><MobileIcon name="close" size={17} /></button> : null}
        </nav>
      </aside>
      {detailsOpen ? (
        <MobileSheetLayer onClose={() => setDetailsOpen(false)}>
          <section className="mv2-sheet mv2-error-sheet" onClick={(event) => event.stopPropagation()}>
            <i />
            <header className="mv2-sheet-heading">
              <span><small>Diagnostic details</small><h2>{info.title}</h2><p>{info.message}</p></span>
              <button type="button" onClick={() => setDetailsOpen(false)} aria-label="Close error details"><MobileIcon name="close" /></button>
            </header>
            <dl>
              <div><dt>Error code</dt><dd>{info.code}</dd></div>
              {info.status ? <div><dt>HTTP status</dt><dd>{info.status}</dd></div> : null}
              {info.details ? <div><dt>Technical detail</dt><dd>{info.details}</dd></div> : null}
            </dl>
            <button type="button" className="mv2-primary" onClick={() => void copyDetails()}>{copied ? "Copied" : "Copy details"}</button>
          </section>
        </MobileSheetLayer>
      ) : null}
    </>
  );
}

export type MobileDataLoadingKind = "profile" | "arsenal" | "presets" | "social";

export function MobileDataLoading({
  kind,
  title,
  detail,
}: {
  kind: MobileDataLoadingKind;
  title: string;
  detail: string;
}) {
  return (
    <section className={`mv2-data-loading is-${kind}`} role="status" aria-live="polite" aria-busy="true">
      <header>
        <i><MobileIcon name={kind} size={21} /></i>
        <span><strong>{title}</strong><small>{detail}</small></span>
      </header>
      <div className="mv2-data-loading-hero" aria-hidden="true">
        <i />
        <span><b /><b /></span>
        <em />
      </div>
      <div className="mv2-data-loading-stats" aria-hidden="true">
        <i /><i /><i /><i />
      </div>
      <div className="mv2-data-loading-rows" aria-hidden="true">
        {[0, 1, 2].map((row) => <div key={row}><i /><span><b /><b /></span></div>)}
      </div>
    </section>
  );
}

export function mobileAvatar(cardId: string | undefined, cards: Array<{ uuid: string; displayIcon?: string; smallArt?: string }>) {
  if (!cardId) return "";
  const card = cards.find((item) => item.uuid.toLowerCase() === cardId.toLowerCase());
  return card?.displayIcon || card?.smallArt || "";
}

export function skinForLoadout(weapon: Weapon, item: LoadoutItemV1 | undefined) {
  if (!item) return weapon.skins.find((skin) => skin.uuid === weapon.defaultSkinUuid);
  return weapon.skins.find(
    (skin) =>
      skin.uuid.toLowerCase() === item.skinId?.toLowerCase() ||
      skin.levels.some((level) => level.uuid.toLowerCase() === item.skinLevelId?.toLowerCase()),
  );
}

export function chromaForLoadout(skin: Skin | undefined, item: LoadoutItemV1 | undefined) {
  if (!skin || !item?.chromaId) return undefined;
  return skin.chromas.find((chroma) => chroma.uuid.toLowerCase() === item.chromaId.toLowerCase());
}

export function skinRenderSources(weapon: Weapon, item: LoadoutItemV1 | undefined, requestedSkin?: Skin, requestedChroma?: Chroma) {
  const skin = requestedSkin || skinForLoadout(weapon, item);
  const chroma = requestedChroma || chromaForLoadout(skin, item);
  const level = skin?.levels.find((candidate) => candidate.uuid.toLowerCase() === item?.skinLevelId?.toLowerCase());
  return [
    chroma?.fullRender,
    chroma?.displayIcon,
    skin?.chromas[0]?.fullRender,
    level?.displayIcon,
    skin?.levels[0]?.displayIcon,
    skin?.displayIcon,
    weapon.displayIcon,
  ];
}

export function buddyForLoadout(buddies: GunBuddy[], item: LoadoutItemV1 | undefined) {
  if (!item?.charmID && !item?.charmLevelID) return undefined;
  return buddies.find(
    (buddy) =>
      buddy.uuid.toLowerCase() === item.charmID?.toLowerCase() ||
      buddy.levels.some((level) => level.uuid.toLowerCase() === item.charmLevelID?.toLowerCase()),
  );
}

export const VP_ID = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";
export const VP_ICON = `https://media.valorant-api.com/currencies/${VP_ID}/displayicon.png`;

export type MobileStoreItem = {
  id: string;
  name: string;
  weaponName: string;
  images: string[];
  price: number;
  tierName: string;
  tierIcon?: string;
  tierColor?: string;
  owned: boolean;
  discount?: number;
};

export function resolveStoreOffer(
  offer: StorefrontOffer,
  weapons: Weapon[],
  tiers: ContentTier[],
  ownedLevelIds: string[],
  fallbackId = "",
  discount?: number,
): MobileStoreItem | null {
  const itemId = offer.Rewards?.[0]?.ItemID || "";
  const tierMap = new Map(tiers.map((tier) => [tier.uuid.toLowerCase(), tier]));
  const owned = new Set(ownedLevelIds.map((id) => id.toLowerCase()));
  for (const weapon of weapons) {
    const skin = weapon.skins.find(
      (candidate) =>
        candidate.uuid.toLowerCase() === itemId.toLowerCase() ||
        candidate.levels.some((level) => level.uuid.toLowerCase() === itemId.toLowerCase()),
    );
    if (!skin) continue;
    const level = skin.levels.find((candidate) => candidate.uuid.toLowerCase() === itemId.toLowerCase());
    const tier = tierMap.get(skin.contentTierUuid?.toLowerCase());
    return {
      id: itemId || fallbackId || skin.uuid,
      name: skin.displayName,
      weaponName: weapon.displayName,
      images: [
        skin.chromas[0]?.fullRender,
        level?.displayIcon,
        skin.levels[0]?.displayIcon,
        skin.displayIcon,
        weapon.displayIcon,
      ].filter((source): source is string => Boolean(source)),
      price: Object.values(offer.Cost || {})[0] || 0,
      tierName: tier?.displayName || "Select Edition",
      tierIcon: tier?.displayIcon,
      tierColor: tier?.highlightColor,
      owned: skin.levels.some((candidate) => owned.has(candidate.uuid.toLowerCase())),
      discount,
    };
  }
  return null;
}

export function offerStyle(item: MobileStoreItem): CSSProperties {
  return {
    "--mv2-tier": item.tierColor ? `#${item.tierColor.replace(/^#/, "").slice(0, 6)}` : "#45606e",
  } as CSSProperties;
}

export function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

export function formatRelative(timestamp: number) {
  if (!timestamp) return "Never";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatQueue(value?: string) {
  const key = (value || "").toLowerCase();
  const labels: Record<string, string> = {
    competitive: "Competitive",
    unrated: "Unrated",
    swiftplay: "Swiftplay",
    spikerush: "Spike Rush",
    deathmatch: "Deathmatch",
    teamdeathmatch: "Team Deathmatch",
    hurm: "Team Deathmatch",
    premier: "Premier",
    custom: "Custom",
  };
  return labels[key] || (value ? value.charAt(0).toUpperCase() + value.slice(1) : "VALORANT");
}

type PublicMap = { uuid?: string; displayName?: string; splash?: string; displayIcon?: string; mapUrl?: string };
type PublicTierSet = { tiers?: Array<{ tier?: number; tierName?: string; smallIcon?: string; largeIcon?: string }> };

let mapsPromise: Promise<Map<string, { name: string; splash: string; icon: string }>> | null = null;
let tiersPromise: Promise<Map<number, { name: string; icon: string }>> | null = null;

export function loadMobileMaps() {
  if (!mapsPromise) {
    mapsPromise = fetchCachedPublicJson<{ data?: PublicMap[] }>("https://valorant-api.com/v1/maps")
      .then((response) => {
        const map = new Map<string, { name: string; splash: string; icon: string }>();
        for (const item of response.data || []) {
          if (!item.uuid) continue;
          const value = { name: item.displayName || "Map", splash: item.splash || "", icon: item.displayIcon || "" };
          map.set(item.uuid.toLowerCase(), value);
          if (item.mapUrl) map.set(item.mapUrl.toLowerCase(), value);
        }
        return map;
      })
      .catch(() => new Map());
  }
  return mapsPromise;
}

export function loadMobileTiers() {
  if (!tiersPromise) {
    tiersPromise = fetchCachedPublicJson<{ data?: PublicTierSet[] }>("https://valorant-api.com/v1/competitivetiers")
      .then((response) => {
        const map = new Map<number, { name: string; icon: string }>();
        for (const set of response.data || []) {
          for (const tier of set.tiers || []) {
            if (typeof tier.tier === "number") {
              map.set(tier.tier, { name: tier.tierName || "", icon: tier.largeIcon || tier.smallIcon || "" });
            }
          }
        }
        return map;
      })
      .catch(() => new Map());
  }
  return tiersPromise;
}
