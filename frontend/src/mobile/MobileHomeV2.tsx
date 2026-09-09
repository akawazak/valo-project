"use client";

import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/context/DataContext";
import {
  fetchCachedPublicJson,
  getAccountXP,
  getDailyTicket,
  getMissions,
  getProfileOverview,
  getPartyStatus,
  getSocialStatus,
  getStorefront,
  getWallet,
  subscribeProgressionEvents,
  subscribeSocialEvents,
  type AccountXPResponse,
  type DailyTicketResponse,
  type LiveMatchResponse,
  type PartyStatusResponse,
  type ProfileOverview,
  type RiotMissionsResponse,
  type SocialStatusResponse,
} from "@/services/api";
import type { StorefrontBundleItem, StorefrontResponse } from "@/lib/types";
import { presenceActivity, presenceState, queueName } from "@/features/party/presence";
import {
  MobileGameImage,
  MobileErrorNotice,
  MobileCosmeticEditorTarget,
  MobileIcon,
  MobileSheetLayer,
  MobileStoreItem,
  mobileAvatar,
  VP_ICON,
  VP_ID,
  formatClock,
  formatRelative,
  offerStyle,
  resolveStoreOffer,
} from "./MobileKit";
import type { HomeSectionId, MobilePreferences } from "./mobilePreferences";

type ContractReward = { type?: string; uuid?: string; amount?: number };
type ContractLevel = { xp?: number; reward?: ContractReward };
type ContractChapter = { isEpilogue?: boolean; levels?: ContractLevel[]; freeRewards?: ContractReward[] | null };
type ContractMeta = {
  uuid: string;
  displayName?: string;
  displayIcon?: string;
  content?: {
    relationType?: string;
    relationUuid?: string;
    chapters?: ContractChapter[];
  };
};
type MissionMeta = {
  uuid: string;
  displayName?: string;
  title?: string;
  type?: string;
  xpGrant?: number;
  objectives?: Array<{ objectiveUuid: string; value: number; description?: string }>;
};
type CurrencyMeta = {
  uuid: string;
  displayName: string;
  displayNameSingular?: string;
  displayIcon?: string;
  rewardPreviewIcon?: string;
};
type SeasonMeta = { uuid: string; displayName: string; startTime: string; endTime: string; type?: string };
type RewardVisual = { id: string; name: string; type: string; image: string; amount: number };
type WalletCurrency = { id: string; amount: number; label: string; name: string; icon: string };
type HomeCache = {
  savedAt: number;
  storefront?: StorefrontResponse | null;
  wallet?: Record<string, number>;
  missions?: RiotMissionsResponse | null;
  daily?: DailyTicketResponse | null;
  accountXP?: AccountXPResponse | null;
  overview?: ProfileOverview | null;
};

function formatProgressRemaining(milliseconds: number) {
  if (milliseconds <= 0) return "Ending soon";
  const days = Math.floor(milliseconds / 86_400_000);
  const hours = Math.floor((milliseconds % 86_400_000) / 3_600_000);
  return days ? `${days}d ${hours}h left` : `${hours}h left`;
}

function HomeQueueClock({ startedAt }: { startedAt?: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  if (!startedAt || startedAt > now + 5_000 || startedAt < now - 86_400_000) return null;
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1_000));
  return <>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</>;
}

function rewardTypeLabel(value?: string) {
  const label = (value || "Reward")
    .replace(/^E?Ares/, "")
    .replace(/Item$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return label || "Reward";
}

function xpSourceLabel(value: string) {
  return ({
    "time-played": "Time played",
    "match-win": "Match win",
    "first-win-of-the-day": "First win",
  } as Record<string, string>)[value] || value.replace(/-/g, " ");
}

function ProgressBar({ value }: { value: number }) {
  return <i className="mv2-progress"><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>;
}

function RewardArtwork({ reward }: { reward: RewardVisual }) {
  if (reward.image) return <img src={reward.image} alt="" />;
  return (
    <span data-reward-type={reward.type}>
      {reward.type === "Player title" ? "TITLE" : reward.type.slice(0, 2).toUpperCase()}
    </span>
  );
}

function recordNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object") return 0;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : 0;
}

export default function MobileHomeV2({
  isActive,
  onInitialLoadSettled,
  preferences,
}: {
  isActive: boolean;
  onOpenLiveMatch: (match: LiveMatchResponse | null) => void;
  onOpenCosmeticEditor: (target: MobileCosmeticEditorTarget) => void;
  onInitialLoadSettled: (accountPuuid: string) => void;
  preferences: MobilePreferences;
}) {
  const {
    activeAccount,
    allBuddies,
    bundles,
    contentTiers,
    isClientHealthy,
    ownedLevelIDs,
    playerCards,
    playerTitles,
    sprays,
    weapons,
  } = useData();
  const [storefront, setStorefront] = useState<StorefrontResponse | null>(null);
  const [wallet, setWallet] = useState<Record<string, number>>({});
  const [missions, setMissions] = useState<RiotMissionsResponse | null>(null);
  const [daily, setDaily] = useState<DailyTicketResponse | null>(null);
  const [accountXP, setAccountXP] = useState<AccountXPResponse | null>(null);
  const [overview, setOverview] = useState<ProfileOverview | null>(null);
  const [social, setSocial] = useState<SocialStatusResponse | null>(null);
  const [party, setParty] = useState<PartyStatusResponse | null>(null);
  const [contractMeta, setContractMeta] = useState<ContractMeta[]>([]);
  const [missionMeta, setMissionMeta] = useState<MissionMeta[]>([]);
  const [currencyMeta, setCurrencyMeta] = useState<CurrencyMeta[]>([]);
  const [seasonMeta, setSeasonMeta] = useState<SeasonMeta[]>([]);
  const [contractTab, setContractTab] = useState<"missions" | "battlepass" | "account">("missions");
  const [contractsCollapsed, setContractsCollapsed] = useState(false);
  const [weeklyExpanded, setWeeklyExpanded] = useState(false);
  const [storeCollapsed, setStoreCollapsed] = useState(false);
  const [battlePassOpen, setBattlePassOpen] = useState(false);
  const [liveExpanded, setLiveExpanded] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [bundleSeconds, setBundleSeconds] = useState(0);
  const [nightMarketSeconds, setNightMarketSeconds] = useState(0);
  const [nightMarketOpen, setNightMarketOpen] = useState(false);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [cachedAt, setCachedAt] = useState(0);
  const initialLoadSettledRef = useRef("");
  const homeCacheRef = useRef<HomeCache | null>(null);
  const backgroundRefreshRef = useRef(false);
  const storeResetRefreshRef = useRef(false);

  const refreshPresence = useCallback(async () => {
    const [socialResult, partyResult] = await Promise.allSettled([getSocialStatus(), getPartyStatus()]);
    if (socialResult.status === "fulfilled") setSocial(socialResult.value);
    if (partyResult.status === "fulfilled") setParty(partyResult.value);
  }, []);

  useEffect(() => {
    if (!activeAccount?.puuid) return;
    try {
      const cached = JSON.parse(localStorage.getItem(`vv-mobile-social:v2:${activeAccount.puuid}`) || "null") as { social?: SocialStatusResponse; party?: PartyStatusResponse } | null;
      if (cached?.social) setSocial(cached.social);
      if (cached?.party) setParty(cached.party);
    } catch { /* Presence cache is optional. */ }
  }, [activeAccount?.puuid]);

  useEffect(() => {
    if (!activeAccount?.puuid || !isClientHealthy) return;
    const controller = new AbortController();
    let debounce = 0;
    const initial = window.setTimeout(() => void refreshPresence(), 250);
    const update = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => void refreshPresence(), 150);
    };
    void subscribeSocialEvents(update, controller.signal).catch(() => undefined);
    const safety = window.setInterval(() => {
      if (isActive && !document.hidden) void refreshPresence();
    }, 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearTimeout(debounce);
      window.clearInterval(safety);
      controller.abort();
    };
  }, [activeAccount?.puuid, isActive, isClientHealthy, refreshPresence]);

  const settleInitialLoad = useCallback((accountPuuid: string) => {
    if (initialLoadSettledRef.current === accountPuuid) return;
    initialLoadSettledRef.current = accountPuuid;
    onInitialLoadSettled(accountPuuid);
  }, [onInitialLoadSettled]);

  const saveHomeCache = useCallback((patch: Partial<HomeCache>) => {
    if (!activeAccount?.puuid) return;
    const next = { ...(homeCacheRef.current || { savedAt: 0 }), ...patch, savedAt: Date.now() };
    homeCacheRef.current = next;
    setCachedAt(next.savedAt);
    try { localStorage.setItem(`vv-mobile-home:v4:${activeAccount.puuid}`, JSON.stringify(next)); } catch { /* Best-effort cache. */ }
  }, [activeAccount?.puuid]);

  const refresh = useCallback(async () => {
    if (!activeAccount || !isClientHealthy) return;
    setLoading(true);
    setError(null);
    const profileOpts = { puuid: activeAccount.puuid, region: activeAccount.region };
    const progressive = <T,>(request: Promise<T>, apply: (value: T) => void, patch: (value: T) => Partial<HomeCache>) =>
      request.then((value) => {
        apply(value);
        saveHomeCache(patch(value));
        return value;
      });

    const coreRequests = [
      progressive(getProfileOverview(profileOpts), setOverview, (value) => ({ overview: value })),
      progressive(getMissions(), setMissions, (value) => ({ missions: value })),
      progressive(getDailyTicket(), setDaily, (value) => ({ daily: value })),
      progressive(getAccountXP(), setAccountXP, (value) => ({ accountXP: value })),
      progressive(getStorefront(), setStorefront, (value) => ({ storefront: value })),
      progressive(getWallet(), setWallet, (value) => ({ wallet: value })),
    ];
    void Promise.allSettled([
      fetchCachedPublicJson<{ data?: ContractMeta[] }>("https://valorant-api.com/v1/contracts").then((value) => setContractMeta(value.data || [])),
      fetchCachedPublicJson<{ data?: MissionMeta[] }>("https://valorant-api.com/v1/missions").then((value) => setMissionMeta(value.data || [])),
      fetchCachedPublicJson<{ data?: CurrencyMeta[] }>("https://valorant-api.com/v1/currencies").then((value) => setCurrencyMeta(value.data || [])),
      fetchCachedPublicJson<{ data?: SeasonMeta[] }>("https://valorant-api.com/v1/seasons").then((value) => setSeasonMeta(value.data || [])),
    ]);
    const essentialResults = await Promise.allSettled(coreRequests.slice(0, 3));
    void Promise.allSettled(coreRequests.slice(3)).then(() => setLoading(false));
    const essentialFailures = essentialResults.filter((result) => result.status === "rejected");
    if (essentialFailures.length === 2) {
      const rejected = essentialFailures[0];
      if (rejected.status === "rejected") setError(rejected.reason);
    }
  }, [activeAccount, isClientHealthy, saveHomeCache]);

  const refreshProgressInBackground = useCallback(async () => {
    if (!activeAccount || !isClientHealthy || backgroundRefreshRef.current) return;
    backgroundRefreshRef.current = true;
    const profileOpts = { puuid: activeAccount.puuid, region: activeAccount.region };
    const requests = [
      getProfileOverview(profileOpts).then((value) => { setOverview(value); saveHomeCache({ overview: value }); }),
      getMissions().then((value) => { setMissions(value); saveHomeCache({ missions: value }); }),
      getDailyTicket().then((value) => { setDaily(value); saveHomeCache({ daily: value }); }),
      getAccountXP().then((value) => { setAccountXP(value); saveHomeCache({ accountXP: value }); }),
    ];
    const results = await Promise.allSettled(requests);
    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length === results.length && failed[0]?.status === "rejected") setError(failed[0].reason);
    backgroundRefreshRef.current = false;
  }, [activeAccount, isClientHealthy, saveHomeCache]);

  const refreshStoreInBackground = useCallback(async () => {
    if (!activeAccount || !isClientHealthy || storeResetRefreshRef.current) return;
    storeResetRefreshRef.current = true;
    const [storeResult, walletResult] = await Promise.allSettled([getStorefront(), getWallet()]);
    if (storeResult.status === "fulfilled") {
      setStorefront(storeResult.value);
      saveHomeCache({ storefront: storeResult.value });
    }
    if (walletResult.status === "fulfilled") {
      setWallet(walletResult.value);
      saveHomeCache({ wallet: walletResult.value });
    }
    if (storeResult.status === "rejected" && walletResult.status === "rejected") {
      window.setTimeout(() => {
        storeResetRefreshRef.current = false;
        setSeconds(1);
      }, 60_000);
    }
  }, [activeAccount, isClientHealthy, saveHomeCache]);

  useEffect(() => {
    if (!activeAccount?.puuid) return;
    const cacheKey = `vv-mobile-home:v4:${activeAccount.puuid}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || "null") as HomeCache | null;
      if (!cached?.savedAt) return;
      homeCacheRef.current = cached;
      setCachedAt(cached.savedAt);
      if (cached.storefront) setStorefront(cached.storefront);
      if (cached.wallet) setWallet(cached.wallet);
      if (cached.missions) setMissions(cached.missions);
      if (cached.daily) setDaily(cached.daily);
      if (cached.accountXP) setAccountXP(cached.accountXP);
      if (cached.overview) setOverview(cached.overview);
      settleInitialLoad(activeAccount.puuid);
    } catch { /* Ignore corrupt cache and fetch normally. */ }
  }, [activeAccount?.puuid, settleInitialLoad]);

  useEffect(() => {
    setContractTab("missions");
    setContractsCollapsed(false);
    setWeeklyExpanded(false);
    setStoreCollapsed(false);
  }, [activeAccount?.puuid]);

  useEffect(() => {
    const accountPuuid = activeAccount?.puuid;
    if (!accountPuuid || !isClientHealthy) return;

    let mounted = true;
    void refresh().finally(() => {
      if (mounted) settleInitialLoad(accountPuuid);
    });
    return () => {
      mounted = false;
    };
  }, [activeAccount?.puuid, isClientHealthy, refresh, settleInitialLoad]);

  useEffect(() => {
    if (!activeAccount?.puuid || !isActive || !isClientHealthy) return;
    const controller = new AbortController();
    let eventTimer = 0;
    const refreshIfStale = () => {
      if (document.visibilityState !== "visible") return;
      const updatedAt = homeCacheRef.current?.savedAt || 0;
      if (Date.now() - updatedAt >= 45_000) void refreshProgressInBackground();
    };
    void subscribeProgressionEvents(() => {
      window.clearTimeout(eventTimer);
      eventTimer = window.setTimeout(() => void refreshProgressInBackground(), 700);
    }, controller.signal).catch(() => undefined);
    const interval = window.setInterval(refreshIfStale, 60_000);
    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.clearTimeout(eventTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
      controller.abort();
    };
  }, [activeAccount?.puuid, isActive, isClientHealthy, refreshProgressInBackground]);

  useEffect(() => {
    const accountPuuid = activeAccount?.puuid;
    if (!accountPuuid) return;

    const timeout = window.setTimeout(() => {
      if (initialLoadSettledRef.current === accountPuuid) return;
      setError((current: unknown) => current || new Error("VantaVault is taking longer than expected to refresh. Cached sections remain available."));
      settleInitialLoad(accountPuuid);
    }, 20_000);
    return () => window.clearTimeout(timeout);
  }, [activeAccount?.puuid, settleInitialLoad]);

  useEffect(() => {
    const remaining = storefront?.SkinsPanelLayout?.SingleItemOffersRemainingDurationInSeconds || 0;
    const rawBundle = storefront?.FeaturedBundle?.Bundles?.[0] || storefront?.FeaturedBundle?.Bundle;
    const bundleRemaining = rawBundle?.DurationRemainingInSeconds || 0;
    const nightRemaining = storefront?.BonusStore?.BonusStoreRemainingDurationInSeconds || 0;
    setSeconds(remaining);
    setBundleSeconds(bundleRemaining);
    setNightMarketSeconds(nightRemaining);
    if (remaining > 0 || bundleRemaining > 0 || nightRemaining > 0) storeResetRefreshRef.current = false;
  }, [storefront]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSeconds((value) => Math.max(0, value - 1));
      setBundleSeconds((value) => Math.max(0, value - 1));
      setNightMarketSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isActive || !storefront || storeResetRefreshRef.current) return;
    const dailyExpired = Boolean(storefront.SkinsPanelLayout) && seconds <= 0;
    const bundleExpired = Boolean(storefront.FeaturedBundle) && bundleSeconds <= 0;
    const nightExpired = Boolean(storefront.BonusStore) && nightMarketSeconds <= 0;
    if (!dailyExpired && !bundleExpired && !nightExpired) return;
    void refreshStoreInBackground();
  }, [bundleSeconds, isActive, nightMarketSeconds, refreshStoreInBackground, seconds, storefront]);

  const contractDefinitions = useMemo(
    () => new Map(contractMeta.map((item) => [item.uuid.toLowerCase(), item])),
    [contractMeta],
  );
  const missionDefinitions = useMemo(
    () => new Map(missionMeta.map((item) => [item.uuid.toLowerCase(), item])),
    [missionMeta],
  );
  const activeContract = useMemo(() => {
    if (!missions) return null;
    const seasonId = overview?.currentSeasonId?.toLowerCase();
    const seasonDefinition = contractMeta.find(
      (item) =>
        item.content?.relationType?.toLowerCase() === "season" &&
        (!seasonId || item.content?.relationUuid?.toLowerCase() === seasonId),
    );
    const requested = missions.ActiveSpecialContract
      ? contractDefinitions.get(missions.ActiveSpecialContract.toLowerCase())
      : undefined;
    const definition = seasonDefinition || requested;
    const progress = definition
      ? missions.Contracts.find((item) => item.ContractDefinitionID.toLowerCase() === definition.uuid.toLowerCase())
      : missions.Contracts[0];
    if (!progress) return null;
    const resolved = definition || contractDefinitions.get(progress.ContractDefinitionID.toLowerCase());
    const chapters = resolved?.content?.chapters || [];
    const levels = chapters.flatMap((chapter) => chapter.levels || []);
    const nextXp = levels[Math.max(0, progress.ProgressionLevelReached)]?.xp || 0;
    return {
      id: resolved?.uuid || progress.ContractDefinitionID,
      name: resolved?.displayName || "Battle Pass",
      icon: resolved?.displayIcon || "",
      level: progress.ProgressionLevelReached,
      current: progress.ProgressionTowardsNextLevel,
      nextXp,
      totalXp: recordNumber(progress.ContractProgression, "TotalProgressionEarned"),
      chapters,
      levels,
    };
  }, [contractDefinitions, contractMeta, missions, overview?.currentSeasonId]);

  const allActiveMissions = useMemo(
    () => (missions?.Missions || []).filter((item) => !item.Complete),
    [missions],
  );
  const completedMissions = useMemo(
    () => (missions?.Missions || []).filter((item) => item.Complete),
    [missions],
  );
  const progressedContracts = useMemo(
    () => (missions?.Contracts || [])
      .filter((item) => item.ProgressionLevelReached > 0 || item.ProgressionTowardsNextLevel > 0)
      .sort((left, right) => (
        recordNumber(right.ContractProgression, "TotalProgressionEarned")
        - recordNumber(left.ContractProgression, "TotalProgressionEarned")
      )),
    [missions],
  );
  const dailyProgress = useMemo(() => {
    const milestones = daily?.Milestones || [];
    const checkpoints = [0, 1, 2, 3].map((index) => {
      const milestone = milestones[index];
      const progress = Math.max(0, Math.min(4, milestone?.Progress || 0));
      return { progress, complete: Boolean(milestone?.BonusApplied || progress >= 4) };
    });
    const completed = checkpoints.filter((item) => item.complete).length;
    return { completed, total: checkpoints.length, checkpoints };
  }, [daily]);

  const rewardCatalog = useMemo(() => {
    const catalog = new Map<string, Omit<RewardVisual, "id" | "amount">>();
    for (const currency of currencyMeta) {
      catalog.set(currency.uuid.toLowerCase(), {
        name: currency.displayNameSingular || currency.displayName,
        type: "Currency",
        image: currency.rewardPreviewIcon || currency.displayIcon || "",
      });
    }
    for (const card of playerCards) {
      catalog.set(card.uuid.toLowerCase(), {
        name: card.displayName,
        type: "Player card",
        image: card.displayIcon || card.wideArt,
      });
    }
    for (const spray of sprays) {
      catalog.set(spray.uuid.toLowerCase(), {
        name: spray.displayName,
        type: "Spray",
        image: spray.fullTransparentIcon || spray.fullIcon || spray.displayIcon,
      });
    }
    for (const buddy of allBuddies) {
      for (const level of buddy.levels) {
        catalog.set(level.uuid.toLowerCase(), {
          name: buddy.displayName,
          type: "Gun buddy",
          image: level.displayIcon,
        });
      }
    }
    for (const weapon of weapons) {
      for (const skin of weapon.skins) {
        const visual = {
          name: skin.displayName,
          type: weapon.displayName,
          image: skin.displayIcon || skin.chromas[0]?.fullRender || weapon.displayIcon,
        };
        catalog.set(skin.uuid.toLowerCase(), visual);
        for (const level of skin.levels) {
          catalog.set(level.uuid.toLowerCase(), {
            ...visual,
            name: level.displayName || skin.displayName,
            image: level.displayIcon || skin.displayIcon || skin.chromas[0]?.fullRender || weapon.displayIcon,
          });
        }
        for (const chroma of skin.chromas) {
          catalog.set(chroma.uuid.toLowerCase(), {
            ...visual,
            name: chroma.displayName || skin.displayName,
            image: chroma.fullRender || chroma.displayIcon || skin.displayIcon || weapon.displayIcon,
          });
        }
      }
    }
    for (const title of playerTitles) {
      catalog.set(title.uuid.toLowerCase(), {
        name: title.titleText || title.displayName,
        type: "Player title",
        image: "",
      });
    }
    return catalog;
  }, [allBuddies, currencyMeta, playerCards, playerTitles, sprays, weapons]);

  const resolveProgressReward = useCallback((reward?: ContractReward): RewardVisual => {
    const id = reward?.uuid?.toLowerCase() || "";
    const resolved = rewardCatalog.get(id);
    return {
      id,
      name: resolved?.name || rewardTypeLabel(reward?.type),
      type: resolved?.type || rewardTypeLabel(reward?.type),
      image: resolved?.image || "",
      amount: reward?.amount || 1,
    };
  }, [rewardCatalog]);

  const battlePassRewards = useMemo(() => (activeContract?.levels || []).map((level, index) => ({
    tier: index + 1,
    xp: level.xp || 0,
    reward: resolveProgressReward(level.reward),
  })), [activeContract?.levels, resolveProgressReward]);

  const completedBattlePassTiers = Math.max(0, Math.min(
    battlePassRewards.length,
    activeContract?.level || 0,
  ));
  const currentBattlePassTier = battlePassRewards.length
    ? Math.min(battlePassRewards.length, completedBattlePassTiers + 1)
    : 0;
  const battlePassChapters = useMemo(() => {
    let tier = 0;
    return (activeContract?.chapters || []).map((chapter, chapterIndex) => {
      const firstTier = tier + 1;
      const rewards = (chapter.levels || []).map((level) => {
        tier += 1;
        return {
          tier,
          xp: level.xp || 0,
          reward: resolveProgressReward(level.reward),
        };
      });
      return {
        id: `${chapterIndex}:${firstTier}`,
        name: chapter.isEpilogue ? "Epilogue" : `Chapter ${chapterIndex + 1}`,
        firstTier,
        lastTier: tier,
        rewards,
        freeRewards: (chapter.freeRewards || []).map(resolveProgressReward),
      };
    });
  }, [activeContract?.chapters, resolveProgressReward]);
  const currentSeason = seasonMeta.find((season) => season.uuid.toLowerCase() === overview?.currentSeasonId?.toLowerCase());
  const seasonRemaining = currentSeason?.endTime
    ? formatProgressRemaining(new Date(currentSeason.endTime).getTime() - Date.now())
    : "";

  const dailyOffers = useMemo(
    () =>
      (storefront?.SkinsPanelLayout?.SingleItemStoreOffers || []).flatMap((offer, index) => {
        const item = resolveStoreOffer(offer, weapons, contentTiers, ownedLevelIDs, `daily:${index}`);
        return item ? [item] : [];
      }),
    [contentTiers, ownedLevelIDs, storefront, weapons],
  );

  const nightOffers = useMemo(
    () =>
      (storefront?.BonusStore?.BonusStoreOffers || []).flatMap((entry, index) => {
        const offer = {
          ...entry.Offer,
          Cost: entry.DiscountCosts || entry.Offer.Cost,
        };
        const item = resolveStoreOffer(
          offer,
          weapons,
          contentTiers,
          ownedLevelIDs,
          `night:${index}`,
          entry.DiscountPercent,
        );
        return item ? [item] : [];
      }),
    [contentTiers, ownedLevelIDs, storefront, weapons],
  );

  const featuredBundle = useMemo(() => {
    const featured = storefront?.FeaturedBundle;
    const raw = featured?.Bundles?.[0] || featured?.Bundle;
    if (!raw?.DataAssetID) return null;
    const meta = bundles.find((bundle) => bundle.uuid.toLowerCase() === raw.DataAssetID?.toLowerCase());
    return meta ? {
      ...meta,
      seconds: raw.DurationRemainingInSeconds || 0,
      items: raw.Items || [],
    } : null;
  }, [bundles, storefront]);

  const bundleItems = useMemo(() => {
    if (!featuredBundle) return [];
    return featuredBundle.items.map((entry: StorefrontBundleItem) => {
      const itemId = entry.Item.ItemID;
      const price = entry.DiscountedPrice ?? entry.BasePrice;
      const skin = resolveStoreOffer(
        {
          OfferID: itemId,
          Cost: { [VP_ID]: price },
          Rewards: [entry.Item],
        },
        weapons,
        contentTiers,
        ownedLevelIDs,
        itemId,
      );
      if (skin) return { ...skin, basePrice: entry.BasePrice, included: price === 0 && entry.BasePrice > 0 };

      const card = playerCards.find((item) => item.uuid.toLowerCase() === itemId.toLowerCase());
      if (card) return {
        id: itemId,
        name: card.displayName,
        weaponName: "Player card",
        images: [card.wideArt, card.largeArt, card.displayIcon].filter(Boolean),
        price,
        basePrice: entry.BasePrice,
        included: price === 0 && entry.BasePrice > 0,
        tierName: "Identity",
        owned: false,
      };

      const spray = sprays.find((item) => item.uuid.toLowerCase() === itemId.toLowerCase());
      if (spray) return {
        id: itemId,
        name: spray.displayName,
        weaponName: "Spray",
        images: [spray.fullTransparentIcon, spray.fullIcon, spray.displayIcon].filter((source): source is string => Boolean(source)),
        price,
        basePrice: entry.BasePrice,
        included: price === 0 && entry.BasePrice > 0,
        tierName: "Expression",
        owned: false,
      };

      const buddy = allBuddies.find((item) =>
        item.uuid.toLowerCase() === itemId.toLowerCase()
        || item.levels.some((level) => level.uuid.toLowerCase() === itemId.toLowerCase()));
      if (buddy) {
        const level = buddy.levels.find((item) => item.uuid.toLowerCase() === itemId.toLowerCase()) || buddy.levels[0];
        return {
          id: itemId,
          name: buddy.displayName,
          weaponName: "Gun buddy",
          images: [level?.displayIcon].filter((source): source is string => Boolean(source)),
          price,
          basePrice: entry.BasePrice,
          included: price === 0 && entry.BasePrice > 0,
          tierName: "Accessory",
          owned: false,
        };
      }

      return {
        id: itemId,
        name: "Bundle cosmetic",
        weaponName: "Included item",
        images: [],
        price,
        basePrice: entry.BasePrice,
        included: price === 0 && entry.BasePrice > 0,
        tierName: "Collection",
        owned: false,
      };
    });
  }, [allBuddies, contentTiers, featuredBundle, ownedLevelIDs, playerCards, sprays, weapons]);

  const bundlePrice = useMemo(
    () => bundleItems.reduce((sum, item) => sum + item.price, 0),
    [bundleItems],
  );
  const passPercent = activeContract?.nextXp
    ? activeContract.current / activeContract.nextXp * 100
    : completedBattlePassTiers >= battlePassRewards.length && battlePassRewards.length ? 100 : 0;
  const nextPassReward = battlePassRewards.find((item) => item.tier === currentBattlePassTier)?.reward;
  const accountLevel = accountXP?.Progress.Level ?? overview?.account.level;
  const accountProgress = accountXP?.Progress.XP || 0;
  const firstWin = useMemo(() => {
    const raw = accountXP?.NextTimeFirstWinAvailable;
    if (!raw) return { available: true, detail: "Available on your next win" };
    const next = new Date(raw);
    const available = Number.isNaN(next.getTime()) || next.getTime() <= Date.now();
    return {
      available,
      detail: available
        ? "Available on your next win"
        : `Claimed · returns ${next.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    };
  }, [accountXP?.NextTimeFirstWinAvailable]);
  const weeklySummary = useMemo(() => {
    const nextMission = allActiveMissions[0];
    const definition = nextMission ? missionDefinitions.get(nextMission.ID.toLowerCase()) : undefined;
    const nextObjective = definition?.objectives?.find((objective) => (
      (nextMission?.Objectives?.[objective.objectiveUuid] || 0) < objective.value
    ));
    const xp = allActiveMissions.reduce((total, mission) => (
      total + (missionDefinitions.get(mission.ID.toLowerCase())?.xpGrant || 0)
    ), 0);
    return {
      title: nextObjective?.description || definition?.displayName || definition?.title || "",
      xp,
    };
  }, [allActiveMissions, missionDefinitions]);
  const walletCurrencies = useMemo<WalletCurrency[]>(() => {
    const ids = [
      { id: VP_ID, label: "VALORANT", name: "VALORANT Points" },
      { id: "e59aa87c-4cbf-517a-5983-6e81511be9b7", label: "Radianite", name: "Radianite Points" },
      { id: "85ca954a-41f2-ce94-9b45-8ca3dd39a00d", label: "Kingdom", name: "Kingdom Credits" },
    ];
    const definitions = new Map(currencyMeta.map((item) => [item.uuid.toLowerCase(), item]));
    return ids.map((currency) => {
      const definition = definitions.get(currency.id);
      return {
        ...currency,
        amount: wallet[currency.id] || 0,
        name: definition?.displayName || currency.name,
        icon: definition?.displayIcon || `https://media.valorant-api.com/currencies/${currency.id}/displayicon.png`,
      };
    });
  }, [currencyMeta, wallet]);

  const renderOffer = (item: MobileStoreItem) => (
    <article className="mv3-store-card" key={item.id} style={offerStyle(item)}>
      <i>{item.tierIcon ? <img src={item.tierIcon} alt="" /> : null}</i>
      <MobileGameImage sources={item.images} alt={item.name} />
      <span><small>{item.weaponName}</small><strong>{item.name}</strong></span>
      {item.discount ? <em>{item.discount}% off</em> : null}
      {item.owned ? <b>Owned</b> : <b><img src={VP_ICON} alt="VP" />{item.price.toLocaleString()}</b>}
    </article>
  );

  const activeParty = party && party.phase !== "none" && party.phase !== "error" ? party : null;
  const ownPresence = social?.selfPresence;
  const ownActivity = ownPresence ? presenceActivity(ownPresence) : null;
  const partyMembers = activeParty?.members || [];
  const partySize = partyMembers.length || ownPresence?.partySize || 0;
  const liveLabel = activeParty?.phase === "coregame"
    ? "In match"
    : activeParty?.phase === "pregame"
      ? "Agent select"
      : activeParty?.phase === "matchmaking"
        ? "In queue"
        : ownActivity?.label || (social?.remoteStatus === "live" ? "VALORANT offline" : "Checking Riot status");
  const liveDetail = [
    ownActivity?.detail,
    partySize > 1 ? `${partySize}/${ownPresence?.maxPartySize || 5} in party` : partySize === 1 ? "Solo party" : "",
  ].filter(Boolean).join(" · ") || (social?.remoteStatus === "live"
    ? `${social?.onlineCount || 0} friends online · social available`
    : "Live presence is unavailable");
  const localPartyMember = partyMembers.find((member) => member.isLocal);
  const ownAvatar = mobileAvatar(ownPresence?.cardId || localPartyMember?.cardId || overview?.playerCardId, playerCards);
  const ownState = ownPresence ? presenceState(ownPresence) : activeParty ? "game" : "offline";
  const homeSectionStyle = (section: HomeSectionId): CSSProperties => ({
    order: preferences.homeOrder.indexOf(section),
    display: preferences.hiddenHomeSections.includes(section) ? "none" : undefined,
  });

  return (
    <div className="mv2-home mv3-briefing">
      {error ? <MobileErrorNotice error={error} onRetry={() => void refresh()} onDismiss={() => setError(null)} /> : null}

      <section className="mv3-home-live" data-state={ownState} data-expanded={liveExpanded} style={homeSectionStyle("presence")}>
        <button
          type="button"
          className="mv3-home-live-main"
          onClick={() => setLiveExpanded((value) => !value)}
          aria-expanded={liveExpanded}
          aria-label={`${liveLabel}. ${liveExpanded ? "Hide" : "Show"} live status details`}
        >
          <span className="mv3-home-live-avatar">
            {ownAvatar ? <img src={ownAvatar} alt="" /> : <img src="/brand-mark.svg" alt="" data-fallback="true" />}
            <i />
          </span>
          <span>
            <small>Live status</small>
            <strong>{liveLabel}</strong>
            <em>{liveDetail}</em>
          </span>
        </button>
        {partyMembers.length > 1 ? <div className="mv3-home-party" aria-label={`${partyMembers.length} party members`}>
          {partyMembers.slice(0, 4).map((member) => {
            const avatar = mobileAvatar(member.cardId, playerCards);
            return <span key={member.puuid} title={member.name}>{avatar ? <img src={avatar} alt="" /> : <b>{member.name.slice(0, 1).toUpperCase()}</b>}</span>;
          })}
          <small>{partyMembers.length}/5</small>
        </div> : <b className="mv3-home-online">{social?.onlineCount || 0}<small>online</small></b>}
        <button type="button" className="mv3-home-live-refresh" onClick={() => void refreshPresence()} aria-label="Refresh live status"><MobileIcon name="refresh" size={17} /></button>
        {liveExpanded ? (
          <div className="mv3-home-live-details">
            <div className="mv3-home-live-summary">
              <span><small>Status</small><strong>{liveLabel}</strong></span>
              <span><small>{activeParty?.phase === "matchmaking" ? "Queue time" : "Playlist"}</small><strong>{activeParty?.phase === "matchmaking" ? <HomeQueueClock startedAt={activeParty.queueStartedAt} /> : queueName(activeParty?.queueId || ownPresence?.queueId || "") || "VALORANT"}</strong></span>
              <span><small>Friends</small><strong>{social?.onlineCount || 0} online</strong></span>
            </div>
            {partyMembers.length ? (
              <div className="mv3-home-live-members">
                {partyMembers.map((member) => {
                  const avatar = mobileAvatar(member.cardId, playerCards);
                  return (
                    <div key={member.puuid}>
                      <span>{avatar ? <img src={avatar} alt="" /> : <b>{member.name.slice(0, 1).toUpperCase()}</b>}</span>
                      <p><strong>{member.name}</strong><small>{member.isLocal ? "You" : member.isOwner ? "Party leader" : `Level ${member.accountLevel || "—"}`}</small></p>
                      <em data-ready={member.isReady}>{member.isReady ? "Ready" : "Not ready"}</em>
                    </div>
                  );
                })}
              </div>
            ) : <p className="mv3-home-live-empty">{ownState === "offline" ? "Riot presence is offline. This updates automatically when you reconnect." : "No active party. Queue and match details will appear here automatically."}</p>}
          </div>
        ) : null}
      </section>

      <section className="mv3-section mv3-contracts" data-collapsed={contractsCollapsed} style={homeSectionStyle("progress")}>
        <header className="mv3-section-heading">
          <span><h2>Contracts</h2><small>{cachedAt ? `Updated ${formatRelative(cachedAt)}` : "Missions and progress"}</small></span>
          <nav className="mv3-heading-actions">
            <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh contracts"><MobileIcon name="refresh" size={19} /></button>
            <button type="button" data-expanded={!contractsCollapsed} onClick={() => setContractsCollapsed((value) => !value)} aria-label={contractsCollapsed ? "Expand contracts" : "Collapse contracts"}><MobileIcon name="chevron" size={18} /></button>
          </nav>
        </header>
        {!contractsCollapsed ? <>
        <nav className="mv3-contract-tabs" aria-label="Contract sections">
          <button type="button" data-active={contractTab === "missions"} onClick={() => setContractTab("missions")}>
            <strong>Missions</strong>
            <small>{dailyProgress.completed}/4 daily · {allActiveMissions.length} active</small>
          </button>
          <button type="button" data-active={contractTab === "battlepass"} onClick={() => setContractTab("battlepass")}>
            <strong>Battle Pass</strong>
            <small>{currentBattlePassTier ? `Tier ${currentBattlePassTier}` : "Loading tier"}</small>
          </button>
          <button type="button" data-active={contractTab === "account"} onClick={() => setContractTab("account")}>
            <strong>Account</strong>
            <small>{accountLevel != null ? `Level ${accountLevel}` : "Loading level"}</small>
          </button>
        </nav>
        {contractTab === "missions" ? <div className="mv3-contract-pane">
          <div className="mv3-contract-pane__heading">
            <span><strong>Daily checkpoints</strong><small>4 charges each · +1,000 XP +150 KC</small></span>
            <b>{daily?.RemainingLifetimeSeconds ? formatClock(daily.RemainingLifetimeSeconds) : "Live"}</b>
          </div>
        <div className="mv3-first-win" data-available={firstWin.available}>
          <i aria-hidden="true" />
          <span><strong>First win bonus</strong><small>{firstWin.detail}</small></span>
          <b>+1,000 XP</b>
        </div>
        <div className="mv3-checkpoints" aria-label={`${dailyProgress.completed} of ${dailyProgress.total} daily checkpoints complete`}>
          {dailyProgress.checkpoints.map((checkpoint, index) => (
            <div key={index} data-state={checkpoint.complete ? "complete" : checkpoint.progress ? "active" : "idle"}>
              <span className="mv3-checkpoint-glyph">
                <svg viewBox="0 0 48 48" aria-hidden="true">
                  <path d="M24 3 45 24" data-filled={checkpoint.progress > 0} />
                  <path d="m45 24-21 21" data-filled={checkpoint.progress > 1} />
                  <path d="M24 45 3 24" data-filled={checkpoint.progress > 2} />
                  <path d="M3 24 24 3" data-filled={checkpoint.progress > 3} />
                </svg>
                <b>{checkpoint.complete ? <MobileIcon name="check" size={15} /> : index + 1}</b>
              </span>
              <small>{checkpoint.complete ? "Claimed" : `${checkpoint.progress}/4`}</small>
            </div>
          ))}
        </div>
        <button type="button" className="mv3-weekly-toggle" data-expanded={weeklyExpanded} onClick={() => setWeeklyExpanded((value) => !value)}>
          <span>
            <strong>Weekly missions</strong>
            <small>{weeklySummary.title ? `Next · ${weeklySummary.title}` : `${completedMissions.length} complete · ${allActiveMissions.length} active`}</small>
          </span>
          <span><b>{weeklySummary.xp ? `+${weeklySummary.xp.toLocaleString()} XP` : `${allActiveMissions.length} active`}</b><small>{weeklyExpanded ? "Hide" : "Show"}</small><MobileIcon name="chevron" size={17} /></span>
        </button>
        {weeklyExpanded ? <div className="mv3-mission-list">
          {allActiveMissions.map((mission, missionIndex) => {
            const meta = missionDefinitions.get(mission.ID.toLowerCase());
            const objectives = meta?.objectives || [];
            const current = objectives.reduce((sum, objective) => sum + Math.min(objective.value, mission.Objectives?.[objective.objectiveUuid] || 0), 0);
            const target = objectives.reduce((sum, objective) => sum + objective.value, 0);
            return (
              <article key={mission.ID}>
                <span className="mv3-mission-index">{String(missionIndex + 1).padStart(2, "0")}</span>
                <div>
                  <span><strong>{meta?.displayName || meta?.title || objectives[0]?.description || "Active mission"}</strong><b>{meta?.xpGrant ? `+${meta.xpGrant.toLocaleString()} XP` : "XP"}</b></span>
                  {objectives.map((objective) => {
                    const objectiveCurrent = mission.Objectives?.[objective.objectiveUuid] || 0;
                    return (
                      <div className="mv3-objective" key={objective.objectiveUuid}>
                        <small>{objective.description || "Mission objective"}<b>{objectiveCurrent.toLocaleString()} / {objective.value.toLocaleString()}</b></small>
                        <ProgressBar value={objectiveCurrent / Math.max(1, objective.value) * 100} />
                      </div>
                    );
                  })}
                  {!objectives.length ? <ProgressBar value={target ? current / target * 100 : 0} /> : null}
                </div>
              </article>
            );
          })}
          {!allActiveMissions.length ? <p>{missions ? "Everything currently available is complete." : loading ? "Loading missions…" : "Mission progress is unavailable."}</p> : null}
        </div> : null}
        </div> : null}

        {contractTab === "battlepass" ? <div className="mv3-contract-pane">
          <div className="mv3-contract-pane__heading">
            <span><strong>{currentSeason?.displayName || "Battle Pass"}</strong><small>{activeContract?.name || "Current season"}</small></span>
            <b>{seasonRemaining || "Current act"}</b>
          </div>
          {activeContract ? (
          <div className="mv3-pass">
            <div className="mv3-pass__tier">
              <small>{currentSeason?.displayName || activeContract.name}</small>
              <strong><span>Tier</span>{currentBattlePassTier || completedBattlePassTiers}</strong>
              <p>{activeContract.current.toLocaleString()} / {Math.max(1, activeContract.nextXp).toLocaleString()} XP</p>
              <ProgressBar value={passPercent} />
            </div>
            <div className="mv3-pass__reward">
              <small>Next reward</small>
              <div>{nextPassReward ? <RewardArtwork reward={nextPassReward} /> : <MobileIcon name="check" size={28} />}</div>
              <strong>{nextPassReward?.name || "Pass complete"}</strong>
              <span>{nextPassReward?.type || `${completedBattlePassTiers} tiers unlocked`}</span>
            </div>
            <button type="button" onClick={() => setBattlePassOpen(true)}>
              <span><strong>Full reward track</strong><small>{completedBattlePassTiers} of {battlePassRewards.length} tiers unlocked</small></span>
              <MobileIcon name="chevron" size={19} />
            </button>
          </div>
          ) : <p className="mv3-empty">{loading ? "Loading the current Battle Pass…" : "Battle Pass information is unavailable."}</p>}
        </div> : null}

        {contractTab === "account" ? <div className="mv3-contract-pane">
          <div className="mv3-contract-pane__heading">
            <span><strong>Account growth</strong><small>Account Points and active events</small></span>
            <b>Level {accountLevel ?? "—"}</b>
          </div>
        <div className="mv3-level-line">
          <strong>{accountProgress.toLocaleString()}<small> / 5,000 AP</small></strong>
          <ProgressBar value={accountProgress / 5_000 * 100} />
          <span>{Math.max(0, 5_000 - accountProgress).toLocaleString()} AP to next level</span>
        </div>
        {accountXP?.History?.[0] ? (
          <div className="mv3-last-growth">
            <span><small>Latest progress</small><strong>+{accountXP.History[0].XPDelta.toLocaleString()} AP</strong></span>
            <p>{accountXP.History[0].XPSources?.map((source) => `${xpSourceLabel(source.ID)} +${source.Amount}`).join(" · ") || "Match AP"}</p>
          </div>
        ) : null}
        {progressedContracts.slice(0, 2).map((contract) => {
          const definition = contractDefinitions.get(contract.ContractDefinitionID.toLowerCase());
          return (
            <div className="mv3-contract" key={contract.ContractDefinitionID}>
              <span>{definition?.displayIcon ? <img src={definition.displayIcon} alt="" /> : <b>{(definition?.displayName || "C").slice(0, 1)}</b>}</span>
              <p><strong>{definition?.displayName || "VALORANT contract"}</strong><small>Tier {contract.ProgressionLevelReached}</small></p>
              <b>{contract.ProgressionTowardsNextLevel.toLocaleString()} XP</b>
            </div>
          );
        })}
        </div> : null}
        </> : null}
      </section>

      <section className="mv3-section mv3-market" data-collapsed={storeCollapsed} style={homeSectionStyle("store")}>
        <header className="mv3-section-heading">
          <span><h2>Store</h2></span>
          <nav className="mv3-store-heading-actions">
            <div className="mv3-wallet-inline" aria-label="Wallet balances">
              {walletCurrencies.map((currency) => (
                <b key={currency.id} title={`${currency.name}: ${currency.amount.toLocaleString()}`}>
                  <img src={currency.icon} alt={currency.label} />
                  <span>{currency.amount.toLocaleString()}</span>
                </b>
              ))}
            </div>
            <button type="button" data-expanded={!storeCollapsed} onClick={() => setStoreCollapsed((value) => !value)} aria-label={storeCollapsed ? "Expand store" : "Collapse store"}><MobileIcon name="chevron" size={18} /></button>
          </nav>
        </header>
        {!storeCollapsed ? <>
        {featuredBundle ? (
          <button
            type="button"
            className="mv3-bundle"
            style={{ "--mv3-bundle": `url(${featuredBundle.displayIcon2 || featuredBundle.displayIcon})` } as CSSProperties}
            onClick={() => setBundleOpen(true)}
          >
            <span><small>Featured collection</small><strong>{featuredBundle.displayName}</strong><b>{bundleItems.length} items · {bundlePrice ? `${bundlePrice.toLocaleString()} VP · ` : ""}{bundleSeconds ? `${formatClock(bundleSeconds)} left` : "Updating…"}</b></span>
            <MobileIcon name="chevron" size={20} />
          </button>
        ) : null}
        {nightOffers.length ? (
          <button type="button" className="mv3-night-market" onClick={() => setNightMarketOpen(true)}>
            <MobileIcon name="store" size={20} />
            <span><strong>Night Market</strong><small>{nightOffers.length} personal offers{nightMarketSeconds ? ` · ${formatProgressRemaining(nightMarketSeconds * 1_000)}` : ""}</small></span>
            <MobileIcon name="chevron" size={18} />
          </button>
        ) : null}
        <div className="mv3-daily-heading"><strong>Daily offers</strong><small>{seconds ? `Refresh in ${formatClock(seconds)}` : "Current rotation"}</small></div>
        <div className="mv3-daily-list">
          {dailyOffers.length ? dailyOffers.map(renderOffer) : <p className="mv3-empty">{loading ? "Loading today’s offers…" : "Daily offers are unavailable."}</p>}
        </div>
        </> : null}
      </section>
      {battlePassOpen && activeContract ? (
        <MobileSheetLayer onClose={() => setBattlePassOpen(false)}>
          <section className="mv2-sheet mv2-battlepass-sheet" onClick={(event) => event.stopPropagation()}>
            <i />
            <header className="mv2-sheet-heading">
              <span><small>Current Battle Pass</small><h2>{activeContract.name}</h2><p>Tier {currentBattlePassTier || completedBattlePassTiers} · {activeContract.totalXp.toLocaleString()} XP earned</p></span>
              <button type="button" onClick={() => setBattlePassOpen(false)} aria-label="Close Battle Pass rewards"><MobileIcon name="close" /></button>
            </header>
            <div className="mv2-pass-sheet-summary">
              <span><strong>{completedBattlePassTiers}</strong><small>tiers complete</small></span>
              <span><strong>{battlePassRewards.length}</strong><small>total tiers</small></span>
              <span><strong>{seasonRemaining || "Live"}</strong><small>act time</small></span>
            </div>
            <div className="mv2-pass-chapters">
              {battlePassChapters.map((chapter) => (
                <section key={chapter.id} className="mv2-pass-chapter">
                  <header>
                    <span><small>{chapter.name}</small><strong>Tiers {chapter.firstTier}–{chapter.lastTier}</strong></span>
                    <b>{chapter.lastTier <= completedBattlePassTiers ? "Complete" : currentBattlePassTier >= chapter.firstTier ? "In progress" : "Upcoming"}</b>
                  </header>
                  <div>
                    {chapter.rewards.map(({ tier, xp, reward }) => {
                      const state = tier <= completedBattlePassTiers ? "complete" : tier === currentBattlePassTier ? "current" : "locked";
                      return (
                        <article key={tier} data-state={state}>
                          <i>{state === "complete" ? <MobileIcon name="check" size={13} /> : tier}</i>
                          <div><RewardArtwork reward={reward} /></div>
                          <span><strong>{reward.name}</strong><small>{reward.type}{reward.amount > 1 ? ` · ×${reward.amount}` : ""}</small></span>
                          <b>{state === "complete" ? "Unlocked" : state === "current" ? `${activeContract.current.toLocaleString()} / ${Math.max(1, xp).toLocaleString()} XP` : `${xp.toLocaleString()} XP`}</b>
                        </article>
                      );
                    })}
                  </div>
                  {chapter.freeRewards.map((reward, index) => (
                    <article className="mv2-pass-free-reward" key={`${reward.id}:${index}`}>
                      <i>F</i>
                      <div><RewardArtwork reward={reward} /></div>
                      <span><strong>{reward.name}</strong><small>Free chapter reward{reward.amount > 1 ? ` · ×${reward.amount}` : ""}</small></span>
                      <b>{chapter.lastTier <= completedBattlePassTiers ? "Unlocked" : `Complete Tier ${chapter.lastTier}`}</b>
                    </article>
                  ))}
                </section>
              ))}
            </div>
          </section>
        </MobileSheetLayer>
      ) : null}
      {nightMarketOpen ? (
        <MobileSheetLayer onClose={() => setNightMarketOpen(false)}>
          <section className="mv2-sheet mv2-night-market-sheet" onClick={(event) => event.stopPropagation()}>
            <i />
            <header>
              <span><small>Personal offers</small><h2>Night Market</h2></span>
              <button type="button" onClick={() => setNightMarketOpen(false)} aria-label="Close Night Market"><MobileIcon name="close" /></button>
            </header>
            <p>{nightMarketSeconds ? `${formatClock(nightMarketSeconds)} remaining` : `${nightOffers.length} discounted offers`}</p>
            <div className="mv3-daily-list mv3-night-list">{nightOffers.map(renderOffer)}</div>
          </section>
        </MobileSheetLayer>
      ) : null}
      {bundleOpen && featuredBundle ? (
        <MobileSheetLayer onClose={() => setBundleOpen(false)}>
          <section className="mv2-sheet mv2-bundle-sheet" onClick={(event) => event.stopPropagation()}>
            <i />
            <header style={{ backgroundImage: `linear-gradient(90deg,rgba(6,11,15,.18),rgba(6,11,15,.9)),url(${featuredBundle.displayIcon2 || featuredBundle.displayIcon})` }}>
              <button type="button" onClick={() => setBundleOpen(false)} aria-label="Close bundle"><MobileIcon name="close" /></button>
              <span><small>Featured collection</small><h2>{featuredBundle.displayName}</h2><p>{featuredBundle.description}</p></span>
            </header>
            <div className="mv2-bundle-summary">
              <span><strong>{bundleItems.length}</strong><small>items</small></span>
              <span><strong>{bundleSeconds ? formatClock(bundleSeconds) : "Updating…"}</strong><small>remaining</small></span>
              <span><strong>{bundlePrice ? bundlePrice.toLocaleString() : "Included"}</strong><small>{bundlePrice ? "VP total" : "collection"}</small></span>
            </div>
            <div className="mv2-bundle-items">
              {bundleItems.map((item) => (
                <article key={item.id} style={offerStyle(item)}>
                  <MobileGameImage sources={item.images} alt={item.name} />
                  <span><small>{item.weaponName}</small><strong>{item.name}</strong></span>
                  <b>{item.owned ? "Owned" : item.included ? "Included" : <><img src={VP_ICON} alt="VP" />{item.price.toLocaleString()}</>}</b>
                </article>
              ))}
            </div>
          </section>
        </MobileSheetLayer>
      ) : null}
    </div>
  );
}
