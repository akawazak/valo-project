"use client";

import { CSSProperties, FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/context/DataContext";
import {
  actOnSocialRequest,
  applyLoadout,
  getChatConversations,
  getChatMessages,
  getLiveMatch,
  getPartyStatus,
  getPlayerLoadoutData,
  getPresets,
  getProfileMatchHistory,
  getProfileOverview,
  getProfileSyncStatus,
  getSocialStatus,
  getStorefront,
  getWallet,
  markChatRead,
  postProfileSync,
  savePresets,
  sendChatMessage,
  sendSocialFriendRequest,
  type ChatConversation,
  type ChatMessage,
  type LiveMatchResponse,
  type LivePlayer,
  type PartyStatusResponse,
  type ProfileMatchSummary,
  type ProfileOverview,
  type ProfileSyncStatus,
  type SocialStatusResponse,
} from "@/services/api";
import type {
  Agent,
  ContentTier,
  GunBuddy,
  LoadoutItemV1,
  Preset,
  RiotAccount,
  Skin,
  StorefrontOffer,
  StorefrontResponse,
  Weapon,
} from "@/lib/types";
import "./MobileApp.css";

type MobileTab = "home" | "arsenal" | "presets" | "social" | "profile";
type IconName =
  | "home"
  | "arsenal"
  | "presets"
  | "social"
  | "profile"
  | "chevron"
  | "back"
  | "refresh"
  | "send"
  | "plus"
  | "store"
  | "party";

type PlayerLoadout = Awaited<ReturnType<typeof getPlayerLoadoutData>>;

type StoreItem = {
  id: string;
  name: string;
  weaponName: string;
  images: string[];
  price: number;
  tierName: string;
  tierIcon?: string;
  tierColor?: string;
  owned: boolean;
};

const VP_ID = "85ad13f7-3d1b-5128-9eb2-7cd8ee0b5741";
const VP_ICON = `https://media.valorant-api.com/currencies/${VP_ID}/displayicon.png`;

const NAV_ITEMS: Array<{ id: MobileTab; label: string; icon: IconName }> = [
  { id: "home", label: "Home", icon: "home" },
  { id: "arsenal", label: "Arsenal", icon: "arsenal" },
  { id: "presets", label: "Presets", icon: "presets" },
  { id: "social", label: "Social", icon: "social" },
  { id: "profile", label: "Profile", icon: "profile" },
];

function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
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
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
    arsenal: <><path d="M3 9.5h10.5l2.7-2.7 4 1.2-2 3.5 2.2 1.6-1.4 2.2-4-1.5-2 1.7H8l-2.4 3H3.2l1.2-4H3z" /><path d="M8 9.5 6.5 6H4" /></>,
    presets: <><path d="M4 6h16" /><path d="M4 12h16" /><path d="M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" /><circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" /></>,
    social: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    chevron: <path d="m9 18 6-6-6-6" />,
    back: <><path d="m15 18-6-6 6-6" /><path d="M9 12h11" /></>,
    refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
    plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
    store: <><path d="M4 9h16l-1-5H5z" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
    party: <><circle cx="8" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M2.5 20a5.5 5.5 0 0 1 11 0" /><path d="M13 16a4.5 4.5 0 0 1 8.5 2" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

function GameImage({
  sources,
  alt = "",
  className,
}: {
  sources: Array<string | null | undefined>;
  alt?: string;
  className?: string;
}) {
  const usable = useMemo(() => Array.from(new Set(sources.filter((source): source is string => Boolean(source)))), [sources]);
  const sourceKey = usable.join("|");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [sourceKey]);

  if (!usable[index]) {
    return <span className={`mobile-game-image-placeholder ${className || ""}`} aria-label={alt}><Icon name="arsenal" /></span>;
  }
  return (
    <img
      className={className}
      src={usable[index]}
      alt={alt}
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

function avatarForCard(cardId: string | undefined, cards: ReturnType<typeof useData>["playerCards"]) {
  if (!cardId) return "";
  return cards.find((card) => card.uuid.toLowerCase() === cardId.toLowerCase())?.smallArt || "";
}

function skinForLoadout(weapon: Weapon, item: LoadoutItemV1 | undefined) {
  if (!item) return weapon.skins.find((skin) => skin.uuid === weapon.defaultSkinUuid);
  return weapon.skins.find(
    (skin) =>
      skin.uuid.toLowerCase() === item.skinId?.toLowerCase() ||
      skin.levels.some((level) => level.uuid.toLowerCase() === item.skinLevelId?.toLowerCase()),
  );
}

function skinRenderSources(
  weapon: Weapon,
  item: LoadoutItemV1 | undefined,
  requestedSkin?: Skin,
) {
  const skin = requestedSkin || skinForLoadout(weapon, item);
  const chroma = skin?.chromas.find(
    (candidate) => candidate.uuid.toLowerCase() === item?.chromaId?.toLowerCase(),
  );
  const level = skin?.levels.find(
    (candidate) => candidate.uuid.toLowerCase() === item?.skinLevelId?.toLowerCase(),
  );
  return [
    chroma?.fullRender,
    skin?.chromas[0]?.fullRender,
    level?.displayIcon,
    skin?.levels[0]?.displayIcon,
    skin?.displayIcon,
    weapon.displayIcon,
  ];
}

function offerItems(
  storefront: StorefrontResponse | null,
  weapons: Weapon[],
  tiers: ContentTier[],
  ownedLevelIds: string[],
): StoreItem[] {
  const offers = storefront?.SkinsPanelLayout?.SingleItemStoreOffers || [];
  const tierMap = new Map(tiers.map((tier) => [tier.uuid.toLowerCase(), tier]));
  const owned = new Set(ownedLevelIds.map((id) => id.toLowerCase()));
  return offers.flatMap((offer: StorefrontOffer, index) => {
    const itemId = offer.Rewards?.[0]?.ItemID || "";
    for (const weapon of weapons) {
      const skin = weapon.skins.find(
        (candidate) =>
          candidate.uuid.toLowerCase() === itemId.toLowerCase() ||
          candidate.levels.some((level) => level.uuid.toLowerCase() === itemId.toLowerCase()),
      );
      if (skin) {
        const level = skin.levels.find((candidate) => candidate.uuid.toLowerCase() === itemId.toLowerCase());
        const tier = tierMap.get(skin.contentTierUuid?.toLowerCase());
        return [{
          id: itemId || `${skin.uuid}:${index}`,
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
        }];
      }
    }
    return [];
  });
}

function formatStoreTime(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
}

function socialActivityLabel(type: string) {
  const labels: Record<string, string> = {
    friend_first_observed: "First seen in your friends list",
    friend_added: "Added to your friends",
    friend_readded: "Added back to your friends",
    friendship_ended: "Removed from your friends",
    request_received: "Sent you a friend request",
    request_sent: "Friend request sent",
    request_cancelled: "Friend request cancelled",
    request_accepted_by_you: "Friend request accepted by you",
    request_accepted_by_them: "Accepted your friend request",
    request_closed_unknown: "Friend request closed",
  };
  return labels[type] || "Friend activity";
}

function MobileLoading() {
  return (
    <div className="mobile-splash" role="status" aria-live="polite">
      <img src="/brand-mark.svg" alt="" />
      <span>VantaVault</span>
      <i />
    </div>
  );
}

function MobileSignIn({
  onConnected,
}: {
  onConnected: (account: RiotAccount) => void;
}) {
  const { startLoginFlow, cancelLoginFlow, loginInFlight, isBackendOnline } = useData();
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const busy = starting || Boolean(loginInFlight);

  const connect = async () => {
    setError("");
    setStarting(true);
    try {
      const account = await startLoginFlow();
      onConnected(account);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (!/cancel/i.test(message)) setError(message);
    } finally {
      setStarting(false);
    }
  };

  return (
    <main className="mobile-auth">
      <header className="mobile-auth__brand">
        <img src="/brand-mark.svg" alt="" />
        <span>VantaVault</span>
      </header>
      <section className="mobile-auth__content">
        <div className="mobile-auth__mark" aria-hidden="true">
          <img src="/brand-mark.svg" alt="" />
        </div>
        <h1>Your loadout, wherever you play.</h1>
        <p>
          Connect your Riot account to manage your store, arsenal, presets,
          profile, and party from your phone.
        </p>
      </section>
      <section className="mobile-auth__actions">
        {error ? <div className="mobile-error" role="alert">{error}</div> : null}
        <button
          className="mobile-primary-button"
          type="button"
          onClick={connect}
          disabled={busy || !isBackendOnline}
        >
          {busy ? <span className="mobile-spinner" /> : null}
          {busy ? "Waiting for Riot…" : "Continue with Riot"}
        </button>
        {busy ? (
          <button className="mobile-text-button" type="button" onClick={cancelLoginFlow}>
            Cancel
          </button>
        ) : null}
        <p className="mobile-auth__security">
          <span aria-hidden="true">⌁</span>
          Your sign-in stays in Riot&apos;s secure window.
        </p>
        {!isBackendOnline ? <p className="mobile-auth__offline">Starting the local service…</p> : null}
      </section>
      <footer>VantaVault is not endorsed by Riot Games.</footer>
    </main>
  );
}

function SectionHeader({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mobile-section-header">
      <h2>{title}</h2>
      {action && onAction ? (
        <button type="button" onClick={onAction}>{action}<Icon name="chevron" size={18} /></button>
      ) : null}
    </div>
  );
}

function PageHeader({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  onAction?: () => void;
}) {
  return (
    <header className="mobile-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {action ? <button type="button" onClick={onAction}>{action}</button> : null}
    </header>
  );
}

function BackHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header className="mobile-back-header">
      <button type="button" onClick={onBack} aria-label="Go back"><Icon name="back" /></button>
      <h1>{title}</h1>
    </header>
  );
}

export default function MobileApp() {
  const data = useData();
  const {
    activeAccount,
    agents,
    accounts,
    allBuddies,
    contentTiers,
    handleAddNewAccount,
    handleDeleteAccount,
    handleSwitchAccount,
    isClientHealthy,
    loading,
    ownedBuddyIDs,
    ownedLevelIDs,
    playerCards,
    weapons,
  } = data;

  const [tab, setTab] = useState<MobileTab>("home");
  const [accountSheet, setAccountSheet] = useState(false);
  const [storefront, setStorefront] = useState<StorefrontResponse | null>(null);
  const [wallet, setWallet] = useState<Record<string, number>>({});
  const [storeSeconds, setStoreSeconds] = useState(0);
  const [party, setParty] = useState<PartyStatusResponse | null>(null);
  const [liveMatch, setLiveMatch] = useState<LiveMatchResponse | null>(null);
  const [liveMatchOpen, setLiveMatchOpen] = useState(false);
  const [social, setSocial] = useState<SocialStatusResponse | null>(null);
  const [playerData, setPlayerData] = useState<PlayerLoadout | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [profile, setProfile] = useState<ProfileOverview | null>(null);
  const [profileSync, setProfileSync] = useState<ProfileSyncStatus | null>(null);
  const [matches, setMatches] = useState<ProfileMatchSummary[]>([]);
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [selectedWeaponId, setSelectedWeaponId] = useState("");
  const [selectedConversation, setSelectedConversation] = useState<ChatConversation | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [newPresetOpen, setNewPresetOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [friendName, setFriendName] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const hasSubpage = Boolean(liveMatchOpen || selectedWeaponId || selectedConversation);

  useEffect(() => {
    if (!hasSubpage) return;

    window.history.pushState({ mobileSubpage: true }, "");
    const closeSubpage = () => {
      setSelectedWeaponId("");
      setSelectedConversation(null);
      setLiveMatchOpen(false);
    };
    window.addEventListener("popstate", closeSubpage, { once: true });
    return () => window.removeEventListener("popstate", closeSubpage);
  }, [hasSubpage]);

  const closeSubpage = useCallback(() => {
    window.history.back();
  }, []);

  const showMessage = useCallback((next: string) => {
    setMessage(next);
    window.setTimeout(() => setMessage(""), 2600);
  }, []);

  const refreshCore = useCallback(async () => {
    if (!activeAccount || !isClientHealthy) return;
    setRefreshing(true);
    setError("");
    const results = await Promise.allSettled([
      getPlayerLoadoutData(),
      getPresets(),
      getStorefront(),
      getWallet(),
      getPartyStatus(),
    ]);
    if (results[0].status === "fulfilled") setPlayerData(results[0].value);
    if (results[1].status === "fulfilled") setPresets(results[1].value);
    if (results[2].status === "fulfilled") setStorefront(results[2].value);
    if (results[3].status === "fulfilled") setWallet(results[3].value);
    if (results[4].status === "fulfilled") {
      const nextParty = results[4].value;
      setParty(nextParty);
      if (nextParty.phase === "coregame") {
        const nextMatch = await getLiveMatch();
        setLiveMatch(nextMatch.phase === "coregame" ? nextMatch : null);
      } else {
        setLiveMatch(null);
        setLiveMatchOpen(false);
      }
    }
    const rejected = results.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") {
      setError(rejected.reason instanceof Error ? rejected.reason.message : "Some account data could not be loaded.");
    }
    setRefreshing(false);
  }, [activeAccount, isClientHealthy]);

  const refreshSocial = useCallback(async () => {
    if (!activeAccount || !isClientHealthy) return;
    const [socialResult, conversationsResult, partyResult] = await Promise.allSettled([
      getSocialStatus(),
      getChatConversations(),
      getPartyStatus(),
    ]);
    if (socialResult.status === "fulfilled") {
      setSocial(socialResult.value);
      if (socialResult.value.status === "unavailable" && socialResult.value.error) {
        setError(socialResult.value.error);
      }
    }
    if (conversationsResult.status === "fulfilled") setConversations(conversationsResult.value.conversations);
    if (partyResult.status === "fulfilled") setParty(partyResult.value);
    const rejected = [socialResult, conversationsResult, partyResult].find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") {
      setError(rejected.reason instanceof Error ? rejected.reason.message : "Social data could not be loaded.");
    }
  }, [activeAccount, isClientHealthy]);

  const refreshProfile = useCallback(async () => {
    if (!activeAccount || !isClientHealthy) return;
    const options = { puuid: activeAccount.puuid, region: activeAccount.region };
    const [overviewResult, historyResult, syncResult] = await Promise.allSettled([
      getProfileOverview(options),
      getProfileMatchHistory(0, 10, undefined, options),
      getProfileSyncStatus(options),
    ]);
    if (overviewResult.status === "fulfilled") setProfile(overviewResult.value);
    if (historyResult.status === "fulfilled") setMatches(historyResult.value.matches || []);
    if (syncResult.status === "fulfilled") setProfileSync(syncResult.value);
    const rejected = [overviewResult, historyResult].find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") {
      setError(rejected.reason instanceof Error ? rejected.reason.message : "Profile data could not be loaded.");
    }
  }, [activeAccount, isClientHealthy]);

  const syncProfile = useCallback(async () => {
    if (!activeAccount || !isClientHealthy) return;
    const options = { puuid: activeAccount.puuid, region: activeAccount.region };
    setBusyAction("profile-sync");
    setError("");
    try {
      await postProfileSync(options);
      showMessage("Match sync started.");
      let finalStatus: ProfileSyncStatus | null = null;
      for (let attempt = 0; attempt < 45; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt < 3 ? 900 : 1800));
        const status = await getProfileSyncStatus(options);
        setProfileSync(status);
        finalStatus = status;
        if (!status.inFlight) break;
      }
      await refreshProfile();
      if (finalStatus?.lastError) {
        if (finalStatus.errorKind === "rate_limited" && finalStatus.retryAt) {
          setError(`Riot rate limit reached. Try again after ${new Date(finalStatus.retryAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`);
        } else {
          setError(finalStatus.lastError);
        }
      } else if (finalStatus?.inFlight) {
        showMessage("Sync is still finishing in the background.");
      } else {
        showMessage("Match history is up to date.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Match history could not be synced.");
    } finally {
      setBusyAction("");
    }
  }, [activeAccount, isClientHealthy, refreshProfile, showMessage]);

  useEffect(() => {
    void refreshCore();
  }, [refreshCore]);

  useEffect(() => {
    if (tab === "social") void refreshSocial();
    if (tab === "profile") void refreshProfile();
  }, [refreshProfile, refreshSocial, tab]);

  useEffect(() => {
    if (!activeAccount || !isClientHealthy) return;
    const timer = window.setInterval(() => {
      void getPartyStatus().then(async (nextParty) => {
        setParty(nextParty);
        if (nextParty.phase === "coregame") {
          const nextMatch = await getLiveMatch();
          setLiveMatch(nextMatch.phase === "coregame" ? nextMatch : null);
        } else {
          setLiveMatch(null);
          setLiveMatchOpen(false);
        }
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [activeAccount, isClientHealthy]);

  useEffect(() => {
    setStoreSeconds(storefront?.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds || 0);
  }, [storefront]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStoreSeconds((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeCard = avatarForCard(playerData?.identity?.playerCardId, playerCards);
  const storeItems = useMemo(
    () => offerItems(storefront, weapons, contentTiers, ownedLevelIDs),
    [contentTiers, ownedLevelIDs, storefront, weapons],
  );
  const selectedWeapon = weapons.find((weapon) => weapon.uuid === selectedWeaponId) || null;
  const weaponGroups = useMemo(() => {
    const labels: Record<string, string> = {
      Sidearm: "Sidearms",
      SMG: "SMGs",
      Shotgun: "Shotguns",
      Rifle: "Rifles",
      Sniper: "Snipers",
      Heavy: "Heavy",
      Melee: "Melee",
    };
    const order = ["Sidearm", "SMG", "Shotgun", "Rifle", "Sniper", "Heavy", "Melee"];
    const groups = new Map<string, Weapon[]>();
    for (const weapon of weapons) {
      const key = weapon.category?.split("::").pop() || "Other";
      groups.set(key, [...(groups.get(key) || []), weapon]);
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => {
        const leftIndex = order.indexOf(left);
        const rightIndex = order.indexOf(right);
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
      })
      .map(([key, items]) => ({ key, label: labels[key] || key, items }));
  }, [weapons]);

  const ownedSkinsFor = useCallback((weapon: Weapon) => {
    const owned = new Set(ownedLevelIDs.map((id) => id.toLowerCase()));
    return weapon.skins.filter(
      (skin) =>
        skin.uuid === weapon.defaultSkinUuid ||
        skin.levels.some((level) => owned.has(level.uuid.toLowerCase())),
    );
  }, [ownedLevelIDs]);

  const ownedBuddies = useMemo(() => {
    const owned = new Set(ownedBuddyIDs.map((buddy) => buddy.levelId.toLowerCase()));
    return allBuddies.filter((buddy) => buddy.levels.some((level) => owned.has(level.uuid.toLowerCase())));
  }, [allBuddies, ownedBuddyIDs]);

  const applyWeaponChange = async (
    weapon: Weapon,
    skin: Skin | null,
    buddy: GunBuddy | null,
  ) => {
    const current = playerData?.loadout[weapon.uuid];
    if (!current) return;
    setBusyAction(`weapon:${weapon.uuid}`);
    setError("");
    try {
      let next: LoadoutItemV1 = { ...current };
      if (skin) {
        const owned = new Set(ownedLevelIDs.map((id) => id.toLowerCase()));
        const level =
          [...skin.levels].reverse().find((candidate) => owned.has(candidate.uuid.toLowerCase())) ||
          skin.levels[skin.levels.length - 1];
        next = {
          ...next,
          skinId: skin.uuid,
          skinLevelId: level?.uuid || next.skinLevelId,
          chromaId: skin.chromas[0]?.uuid || next.chromaId,
        };
      }
      if (buddy) {
        const owned = new Set(ownedBuddyIDs.map((item) => item.levelId.toLowerCase()));
        const level = buddy.levels.find((candidate) => owned.has(candidate.uuid.toLowerCase()));
        if (level) next = { ...next, charmID: buddy.uuid, charmLevelID: level.uuid };
      }
      await applyLoadout({ loadout: { [weapon.uuid]: next } });
      setPlayerData((currentData) => currentData ? {
        ...currentData,
        loadout: { ...currentData.loadout, [weapon.uuid]: next },
      } : currentData);
      showMessage(`${skin?.displayName || buddy?.displayName || weapon.displayName} applied.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply that loadout change.");
    } finally {
      setBusyAction("");
    }
  };

  const applyPreset = async (preset: Preset) => {
    setBusyAction(`preset:${preset.uuid}`);
    setError("");
    try {
      await applyLoadout({
        loadout: preset.loadout,
        identity: preset.identity,
        sprays: preset.sprays,
        flexes: preset.flexes,
        expressions: preset.expressions,
      });
      const fresh = await getPlayerLoadoutData();
      setPlayerData(fresh);
      showMessage(`${preset.name} applied.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not apply that preset.");
    } finally {
      setBusyAction("");
    }
  };

  const createPreset = async (event: FormEvent) => {
    event.preventDefault();
    const name = newPresetName.trim();
    if (!name || !playerData) return;
    const next: Preset = {
      uuid: crypto.randomUUID(),
      name,
      loadout: { ...playerData.loadout },
      agents: [],
      identity: playerData.identity,
      sprays: playerData.sprays,
      flexes: playerData.flexes,
      expressions: playerData.expressions,
    };
    setBusyAction("new-preset");
    try {
      const updated = [...presets, next];
      await savePresets(updated);
      setPresets(updated);
      setNewPresetOpen(false);
      setNewPresetName("");
      showMessage(`${name} saved.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the preset.");
    } finally {
      setBusyAction("");
    }
  };

  const removePreset = async (preset: Preset) => {
    setBusyAction(`delete:${preset.uuid}`);
    try {
      const updated = presets.filter((candidate) => candidate.uuid !== preset.uuid);
      await savePresets(updated);
      setPresets(updated);
      showMessage(`${preset.name} deleted.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete the preset.");
    } finally {
      setBusyAction("");
    }
  };

  const openConversation = async (conversation: ChatConversation) => {
    setSelectedConversation(conversation);
    setChatMessages([]);
    try {
      const result = await getChatMessages(conversation.key);
      setChatMessages(result.messages);
      await markChatRead(conversation.key);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not open the conversation.");
    }
  };

  const submitChat = async (event: FormEvent) => {
    event.preventDefault();
    const body = chatDraft.trim();
    if (!body || !selectedConversation) return;
    setChatDraft("");
    try {
      const sent = await sendChatMessage(selectedConversation.key, body, crypto.randomUUID());
      setChatMessages((current) => [...current, sent]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Message could not be sent.");
      setChatDraft(body);
    }
  };

  const submitFriend = async (event: FormEvent) => {
    event.preventDefault();
    const [gameName, ...tagParts] = friendName.trim().split("#");
    const gameTag = tagParts.join("#");
    if (!gameName || !gameTag) {
      setError("Enter a Riot ID as Name#Tag.");
      return;
    }
    setBusyAction("friend");
    try {
      await sendSocialFriendRequest(gameName, gameTag);
      setFriendName("");
      await refreshSocial();
      showMessage(`Request sent to ${gameName}#${gameTag}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Friend request could not be sent.");
    } finally {
      setBusyAction("");
    }
  };

  const actOnRequest = async (puuid: string, action: "accept" | "deny" | "cancel") => {
    setBusyAction(`request:${puuid}:${action}`);
    try {
      await actOnSocialRequest(puuid, action);
      await refreshSocial();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Friend request could not be updated.");
    } finally {
      setBusyAction("");
    }
  };

  if (loading) return <MobileLoading />;
  if (!activeAccount) {
    return <MobileSignIn onConnected={handleAddNewAccount} />;
  }

  const accountName = `${activeAccount.gameName}#${activeAccount.tagLine}`;

  const homePage = (
    <>
      {party?.phase === "coregame" ? (
        <button
          className="mobile-activity-row"
          type="button"
          onClick={() => {
            setLiveMatchOpen(true);
            void getLiveMatch().then((match) => setLiveMatch(match.phase === "coregame" ? match : null));
          }}
        >
          <span className="mobile-icon-box"><Icon name="arsenal" /></span>
          <span>
            <strong>Live match</strong>
            <small>{party.queueId || "Open live activity"}</small>
          </span>
          <Icon name="chevron" />
        </button>
      ) : null}

      <div className="mobile-store-heading">
        <div>
          <h2>Daily store</h2>
          <span>{storeSeconds > 0 ? `Refreshes in ${formatStoreTime(storeSeconds)}` : "Current Riot offers"}</span>
        </div>
        <div className="mobile-vp-balance">
          <img src={VP_ICON} alt="VP" />
          <strong>{(wallet[VP_ID] || 0).toLocaleString()}</strong>
        </div>
      </div>
      <div className="mobile-store-stack" aria-label="Daily store offers">
        {storeItems.length ? storeItems.map((item) => (
          <article
            key={item.id}
            style={{ "--mobile-offer-tier": item.tierColor ? `#${item.tierColor.replace(/^#/, "")}` : "#536370" } as CSSProperties}
          >
            <div className="mobile-store-visual">
              <div className="mobile-store-meta">
                <span>{item.tierIcon ? <img src={item.tierIcon} alt="" /> : null}{item.tierName}</span>
                <span>{item.weaponName}</span>
              </div>
              {item.owned ? <i>Owned</i> : null}
              <GameImage sources={item.images} alt={item.name} />
            </div>
            <footer>
              <strong>{item.name}</strong>
              <span><img src={VP_ICON} alt="VP" />{item.price.toLocaleString()}</span>
            </footer>
          </article>
        )) : (
          <div className="mobile-empty-row">
            <Icon name="store" />
            <span>{refreshing ? "Loading your store…" : "Store offers are unavailable right now."}</span>
          </div>
        )}
      </div>
    </>
  );

  const arsenalPage = selectedWeapon ? (
    <WeaponDetail
      weapon={selectedWeapon}
      current={playerData?.loadout[selectedWeapon.uuid]}
      skins={ownedSkinsFor(selectedWeapon)}
      buddies={ownedBuddies}
      busy={busyAction === `weapon:${selectedWeapon.uuid}`}
      onBack={closeSubpage}
      onSkin={(skin) => void applyWeaponChange(selectedWeapon, skin, null)}
      onBuddy={(buddy) => void applyWeaponChange(selectedWeapon, null, buddy)}
    />
  ) : (
    <>
      <PageHeader
        title="Arsenal"
        subtitle="Your current weapons and cosmetics"
        action={<Icon name="refresh" />}
        onAction={() => void refreshCore()}
      />
      <div className="mobile-arsenal-groups">
        {weaponGroups.map((group) => (
          <section key={group.key}>
            <h2>{group.label}</h2>
            <div className="mobile-weapon-grid">
              {group.items.map((weapon) => {
                const item = playerData?.loadout[weapon.uuid];
                const skin = skinForLoadout(weapon, item);
                return (
                  <button type="button" key={weapon.uuid} onClick={() => setSelectedWeaponId(weapon.uuid)}>
                    <GameImage sources={skinRenderSources(weapon, item)} alt={weapon.displayName} />
                    <span>
                      <strong>{weapon.displayName}</strong>
                      <small>{skin?.displayName || "Standard"}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );

  const presetsPage = (
    <>
      <PageHeader
        title="Presets"
        subtitle={`${presets.length} saved loadout${presets.length === 1 ? "" : "s"}`}
        action={<Icon name="plus" />}
        onAction={() => setNewPresetOpen(true)}
      />
      <div className="mobile-preset-list">
        {presets.length ? presets.map((preset) => {
          const preview = Object.entries(preset.loadout).slice(0, 3).flatMap(([weaponId, item]) => {
            const weapon = weapons.find((candidate) => candidate.uuid === weaponId);
            return weapon ? [{ key: weaponId, sources: skinRenderSources(weapon, item), name: weapon.displayName }] : [];
          });
          return (
            <article key={preset.uuid}>
              <div className="mobile-preset-preview">
                {preview.length ? preview.map((image, index) => (
                  <GameImage key={`${image.key}:${index}`} sources={image.sources} alt={image.name} />
                )) : <Icon name="presets" size={28} />}
              </div>
              <div>
                <strong>{preset.name}</strong>
                <span>{Object.keys(preset.loadout).length} weapon changes</span>
              </div>
              <button type="button" onClick={() => void applyPreset(preset)} disabled={busyAction === `preset:${preset.uuid}`}>
                {busyAction === `preset:${preset.uuid}` ? "Applying…" : "Apply"}
              </button>
              <button className="mobile-row-delete" type="button" onClick={() => void removePreset(preset)} aria-label={`Delete ${preset.name}`}>
                ×
              </button>
            </article>
          );
        }) : (
          <div className="mobile-empty-state">
            <Icon name="presets" size={34} />
            <h2>No presets yet</h2>
            <p>Save your current loadout so you can apply it again later.</p>
            <button type="button" onClick={() => setNewPresetOpen(true)}>Create preset</button>
          </div>
        )}
      </div>
    </>
  );

  const socialPage = selectedConversation ? (
    <ChatThread
      conversation={selectedConversation}
      messages={chatMessages}
      draft={chatDraft}
      onDraft={setChatDraft}
      onBack={closeSubpage}
      onSubmit={submitChat}
    />
  ) : (
    <>
      <PageHeader
        title="Social"
        subtitle={social?.status === "ok" ? `${social.onlineCount} online · ${social.inGameCount} in match` : "Friends, party and messages"}
        action={<Icon name="refresh" />}
        onAction={() => void refreshSocial()}
      />
      {social && social.friendCount > 0 ? (
        <section className="mobile-social-summary">
          <div><strong>{social.onlineCount}</strong><span>Online</span></div>
          <div><strong>{social.inGameCount}</strong><span>In match</span></div>
          <div><strong>{social.friendCount}</strong><span>Friends</span></div>
        </section>
      ) : null}
      {party?.members?.length ? (
        <>
          <SectionHeader title="Party" />
          <div className="mobile-party-list">
            {party.members.map((member) => (
          <div key={member.puuid}>
            <div className="mobile-avatar small">
              {avatarForCard(member.cardId, playerCards) ? <img src={avatarForCard(member.cardId, playerCards)} alt="" /> : <span>{member.name.slice(0, 1)}</span>}
            </div>
            <span><strong>{member.name}</strong><small>{member.isOwner ? "Party leader" : member.isReady ? "Ready" : "Not ready"}</small></span>
          </div>
            ))}
          </div>
        </>
      ) : null}
      <form className="mobile-friend-form" onSubmit={submitFriend}>
        <label htmlFor="mobile-riot-id">Add friend</label>
        <div>
          <input id="mobile-riot-id" value={friendName} onChange={(event) => setFriendName(event.target.value)} placeholder="Name#Tag" />
          <button type="submit" disabled={busyAction === "friend"}><Icon name="plus" /></button>
        </div>
      </form>
      {social?.presences?.length ? (
        <>
          <SectionHeader title="Friends" />
          <div className="mobile-friend-list">
            {social.presences.map((presence, index) => (
              <div key={presence.puuid || `${presence.name || "friend"}:${index}`}>
                <div className="mobile-avatar small">
                  {avatarForCard(presence.cardId, playerCards)
                    ? <img src={avatarForCard(presence.cardId, playerCards)} alt="" />
                    : <span>{(presence.name || "?").slice(0, 1).toUpperCase()}</span>}
                  <i className="online" />
                </div>
                <span>
                  <strong>{presence.name || "Riot friend"}</strong>
                  <small>{presence.state === "INGAME" || presence.queueId ? presence.queueId || "In match" : presence.availability || "Online"}</small>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {social?.requests?.length ? (
        <>
          <SectionHeader title="Requests" />
          <div className="mobile-request-list">
            {social.requests.map((request) => (
              <div key={`${request.direction}:${request.puuid}`}>
                <span><strong>{request.name}</strong><small>{request.direction === "incoming" ? "Wants to be friends" : "Request sent"}</small></span>
                {request.direction === "incoming" ? (
                  <>
                    <button type="button" onClick={() => void actOnRequest(request.puuid, "accept")}>Accept</button>
                    <button type="button" className="secondary" onClick={() => void actOnRequest(request.puuid, "deny")}>Decline</button>
                  </>
                ) : (
                  <button type="button" className="secondary" onClick={() => void actOnRequest(request.puuid, "cancel")}>Cancel</button>
                )}
              </div>
            ))}
          </div>
        </>
      ) : null}
      {conversations.length ? (
        <>
          <SectionHeader title="Messages" />
          <div className="mobile-conversation-list">
            {conversations.map((conversation) => (
              <button type="button" key={conversation.key} onClick={() => void openConversation(conversation)}>
                <span className="mobile-icon-box"><Icon name={conversation.type === "party" ? "party" : "profile"} /></span>
                <span>
                  <strong>{conversation.displayName}</strong>
                  <small>{conversation.latestMessage?.body || (conversation.type === "party" ? "Party chat" : "No messages yet")}</small>
                </span>
                {conversation.unreadCount ? <i>{conversation.unreadCount}</i> : <Icon name="chevron" />}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {social?.activity?.length ? (
        <>
          <SectionHeader title="Recent activity" />
          <div className="mobile-social-activity">
            {social.activity.slice(0, 8).map((activity) => (
              <div key={activity.id}>
                <span><strong>{activity.name || "Riot player"}</strong><small>{socialActivityLabel(activity.type)}</small></span>
                <time>{new Date(activity.occurredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {!party?.members?.length && !social?.presences?.length && !social?.requests?.length && !conversations.length && !social?.activity?.length ? (
        <p className="mobile-social-empty">Your Riot friends, party, and messages will appear here.</p>
      ) : null}
    </>
  );

  const profilePage = (
    <>
      <PageHeader
        title="Profile"
        subtitle={accountName}
        action={<Icon name="refresh" />}
        onAction={() => void refreshProfile()}
      />
      <section className="mobile-profile-hero">
        <div className="mobile-avatar large">
          {activeCard ? <img src={activeCard} alt="" /> : <span>{activeAccount.gameName.slice(0, 1)}</span>}
        </div>
        <div>
          <h2>{profile?.currentRank?.tierName || "Unranked"}</h2>
          <p>{profile?.account?.level ? `Account level ${profile.account.level}` : "Rank data unavailable"}</p>
        </div>
      </section>
      <section className="mobile-profile-stats">
        <div><strong>{profile?.seasonSummary?.matches ?? "—"}</strong><span>Matches</span></div>
        <div><strong>{profile?.seasonSummary ? `${Math.round(profile.seasonSummary.winrate)}%` : "—"}</strong><span>Win rate</span></div>
        <div><strong>{profile?.seasonSummary?.avgKda?.toFixed(1) ?? "—"}</strong><span>Average KDA</span></div>
      </section>
      <section className="mobile-profile-sync">
        <div>
          <strong>{profileSync?.inFlight ? "Syncing match history" : "Match history"}</strong>
          <span>
            {profileSync?.inFlight
              ? `${profileSync.totalMatches} matches cached so far`
              : profileSync?.lastSyncedAt
                ? `${profileSync.totalMatches} cached · Updated ${new Date(profileSync.lastSyncedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                : "Fetch once, then reuse the local cache."}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void syncProfile()}
          disabled={busyAction === "profile-sync" || profileSync?.inFlight}
        >
          {busyAction === "profile-sync" || profileSync?.inFlight ? "Syncing…" : matches.length ? "Sync now" : "Sync matches"}
        </button>
      </section>
      <SectionHeader title="Recent matches" />
      <div className="mobile-match-list">
        {matches.length ? matches.map((match) => (
          <article key={match.matchId}>
            <i className={match.win ? "win" : "loss"} />
            <div>
              <strong>{match.queueID || match.gameMode || "Match"}</strong>
              <span>{new Date(match.gameStartMillis).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            </div>
            <b>{match.blueRoundsWon} – {match.redRoundsWon}</b>
            <span className={match.win ? "win-text" : "loss-text"}>{match.win ? "Victory" : "Defeat"}</span>
          </article>
        )) : <p className="mobile-muted-block">No recent matches are cached yet.</p>}
      </div>
    </>
  );

  const pages: Record<MobileTab, ReactNode> = {
    home: liveMatchOpen ? <MobileLiveMatch match={liveMatch} agents={agents} onBack={closeSubpage} /> : homePage,
    arsenal: arsenalPage,
    presets: presetsPage,
    social: socialPage,
    profile: profilePage,
  };

  const isSubpage = Boolean(liveMatchOpen || selectedWeapon || selectedConversation);

  return (
    <div className="mobile-app">
      {tab === "home" && !liveMatchOpen ? (
        <header className="mobile-app-bar">
          <div><img src="/brand-mark.svg" alt="" /><strong>VantaVault</strong></div>
          <button type="button" onClick={() => setAccountSheet(true)} aria-label="Open account menu">
            {activeCard ? <img src={activeCard} alt="" /> : <span>{activeAccount.gameName.slice(0, 1)}</span>}
          </button>
        </header>
      ) : null}
      <main className="mobile-page">
        {error ? <div className="mobile-error mobile-error--page" role="alert">{error}<button type="button" onClick={() => setError("")}>×</button></div> : null}
        {pages[tab]}
      </main>

      {!isSubpage ? (
        <nav className="mobile-bottom-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={tab === item.id ? "active" : ""}
              onClick={() => {
                setTab(item.id);
                setSelectedWeaponId("");
                setSelectedConversation(null);
              }}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {message ? <div className="mobile-toast" role="status">{message}</div> : null}

      {accountSheet ? (
        <div className="mobile-sheet-layer" onClick={() => setAccountSheet(false)}>
          <section className="mobile-sheet" onClick={(event) => event.stopPropagation()}>
            <i className="mobile-sheet-handle" />
            <h2>Accounts</h2>
            {accounts.map((account) => (
              <button
                type="button"
                className={account.puuid === activeAccount.puuid ? "selected" : ""}
                key={account.puuid}
                onClick={() => {
                  handleSwitchAccount(account);
                  setAccountSheet(false);
                }}
              >
                <span className="mobile-avatar small">{account.gameName.slice(0, 1).toUpperCase()}</span>
                <span><strong>{account.gameName}#{account.tagLine}</strong><small>{account.puuid === activeAccount.puuid ? "Current account" : account.region.toUpperCase()}</small></span>
                {account.puuid === activeAccount.puuid ? <i>✓</i> : null}
              </button>
            ))}
            <button
              type="button"
              className="mobile-sheet-action"
              onClick={async () => {
                setAccountSheet(false);
                try {
                  const account = await data.startLoginFlow();
                  handleAddNewAccount(account);
                } catch (reason) {
                  const text = reason instanceof Error ? reason.message : String(reason);
                  if (!/cancel/i.test(text)) setError(text);
                }
              }}
            >
              <Icon name="plus" /> Add Riot account
            </button>
            <button
              type="button"
              className="mobile-sheet-danger"
              onClick={async () => {
                try {
                  await handleDeleteAccount(activeAccount.puuid);
                  setAccountSheet(false);
                } catch {
                  // DataContext already surfaced the cleanup failure.
                }
              }}
            >
              Remove current account
            </button>
          </section>
        </div>
      ) : null}

      {newPresetOpen ? (
        <div className="mobile-sheet-layer" onClick={() => setNewPresetOpen(false)}>
          <form className="mobile-sheet mobile-form-sheet" onSubmit={createPreset} onClick={(event) => event.stopPropagation()}>
            <i className="mobile-sheet-handle" />
            <h2>New preset</h2>
            <p>Save your current loadout as a reusable preset.</p>
            <label htmlFor="mobile-preset-name">Preset name</label>
            <input id="mobile-preset-name" autoFocus value={newPresetName} onChange={(event) => setNewPresetName(event.target.value)} maxLength={48} />
            <button className="mobile-primary-button" type="submit" disabled={!newPresetName.trim() || busyAction === "new-preset"}>
              {busyAction === "new-preset" ? "Saving…" : "Save preset"}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function MobileLiveMatch({
  match,
  agents,
  onBack,
}: {
  match: LiveMatchResponse | null;
  agents: Agent[];
  onBack: () => void;
}) {
  const players = [...(match?.allyTeam || []), ...(match?.enemyTeam || [])];
  const partyLabels = new Map<string, string>();
  for (const player of players) {
    if (player.partyGroup && !partyLabels.has(player.partyGroup)) {
      partyLabels.set(player.partyGroup, "Your party");
    }
  }

  const playerRow = (player: LivePlayer) => {
    const agent = agents.find((candidate) => candidate.uuid.toLowerCase() === player.agentId?.toLowerCase());
    return (
      <article key={player.puuid} className={player.isLocal ? "local" : ""}>
        <div className="mobile-live-agent">
          {agent?.displayIcon ? <img src={agent.displayIcon} alt="" /> : <span>{player.name.slice(0, 1).toUpperCase()}</span>}
        </div>
        <div>
          <strong>{player.name}{player.isLocal ? " · You" : ""}</strong>
          <span>{agent?.displayName || "Agent"}</span>
        </div>
        {player.partyGroup ? <i>{partyLabels.get(player.partyGroup)}</i> : null}
      </article>
    );
  };

  return (
    <div className="mobile-live-match">
      <BackHeader title="Live match" onBack={onBack} />
      {!match ? (
        <div className="mobile-empty-state">
          <span className="mobile-spinner" />
          <h2>Loading live match</h2>
          <p>Using the current Riot match state.</p>
        </div>
      ) : (
        <>
          <div className="mobile-live-meta">
            <span>{match.queueId || "Live match"}</span>
            <span>Current Riot match</span>
          </div>
          <section className="mobile-live-score">
            <div><span>Your team</span><strong>{match.scoreAvailable ? match.allyScore ?? 0 : "—"}</strong></div>
            <b>VS</b>
            <div><span>Opponents</span><strong>{match.scoreAvailable ? match.enemyScore ?? 0 : "—"}</strong></div>
          </section>
          <SectionHeader title="Your team" />
          <div className="mobile-live-team ally">
            {(match.allyTeam || []).map(playerRow)}
          </div>
          <SectionHeader title="Opponents" />
          <div className="mobile-live-team enemy">
            {(match.enemyTeam || []).map(playerRow)}
          </div>
        </>
      )}
    </div>
  );
}

function WeaponDetail({
  weapon,
  current,
  skins,
  buddies,
  busy,
  onBack,
  onSkin,
  onBuddy,
}: {
  weapon: Weapon;
  current?: LoadoutItemV1;
  skins: Skin[];
  buddies: GunBuddy[];
  busy: boolean;
  onBack: () => void;
  onSkin: (skin: Skin) => void;
  onBuddy: (buddy: GunBuddy) => void;
}) {
  const selectedSkin = skinForLoadout(weapon, current);
  return (
    <div className="mobile-subpage">
      <BackHeader title={weapon.displayName} onBack={onBack} />
      <section className="mobile-weapon-hero">
        <GameImage sources={skinRenderSources(weapon, current)} alt={selectedSkin?.displayName || weapon.displayName} />
        <strong>{selectedSkin?.displayName || "Standard"}</strong>
        <span>Currently equipped</span>
      </section>
      <SectionHeader title="Skins" />
      <div className="mobile-skin-grid">
        {skins.map((skin) => {
          const selected = selectedSkin?.uuid === skin.uuid;
          return (
            <button type="button" className={selected ? "selected" : ""} key={skin.uuid} onClick={() => onSkin(skin)} disabled={busy}>
              <GameImage sources={skinRenderSources(weapon, current, skin)} alt={skin.displayName} />
              <span>{skin.displayName}</span>
              {selected ? <i>Equipped</i> : null}
            </button>
          );
        })}
      </div>
      <SectionHeader title="Buddies" />
      <div className="mobile-buddy-rail">
        {buddies.map((buddy) => (
          <button type="button" key={buddy.uuid} onClick={() => onBuddy(buddy)} disabled={busy}>
            <img src={buddy.levels[0]?.displayIcon} alt="" />
            <span>{buddy.displayName}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatThread({
  conversation,
  messages,
  draft,
  onDraft,
  onBack,
  onSubmit,
}: {
  conversation: ChatConversation;
  messages: ChatMessage[];
  draft: string;
  onDraft: (value: string) => void;
  onBack: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="mobile-chat">
      <BackHeader title={conversation.displayName} onBack={onBack} />
      <div className="mobile-chat-messages">
        {messages.length ? messages.map((message) => (
          <article className={message.direction === "outgoing" ? "outgoing" : "incoming"} key={message.id}>
            {message.direction === "incoming" && message.senderName ? <strong>{message.senderName}</strong> : null}
            <p>{message.body}</p>
            <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
          </article>
        )) : <p className="mobile-muted-block">No messages in this conversation yet.</p>}
      </div>
      <form className="mobile-chat-compose" onSubmit={onSubmit}>
        <input value={draft} onChange={(event) => onDraft(event.target.value)} placeholder="Message" aria-label="Message" />
        <button type="submit" disabled={!draft.trim()} aria-label="Send message"><Icon name="send" /></button>
      </form>
    </div>
  );
}
