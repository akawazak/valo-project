"use client";

import { useCallback, useEffect, useState } from "react";
import { useData } from "@/context/DataContext";
import { getPlayerLoadoutData, type LiveMatchResponse } from "@/services/api";
import type { RiotAccount } from "@/lib/types";
import MobileArsenalV2 from "./MobileArsenalV2";
import MobileHomeV2 from "./MobileHomeV2";
import {
  MobileCosmeticEditorTarget,
  MobileIcon,
  MobileSheetLayer,
  MobileTab,
  mobileAvatar,
} from "./MobileKit";
import MobilePresetsV2 from "./MobilePresetsV2";
import MobileProfileV2, { type MobileProfileTarget } from "./MobileProfileV2";
import MobileSocialV2 from "./MobileSocialV2";
import MobileSettingsV2 from "./MobileSettingsV2";
import { loadMobilePreferences, saveMobilePreferences } from "./mobilePreferences";
import { MobileLiveMatchPage, MobileLoadingV2, MobileSignInV2 } from "./MobileShellPages";
import "./MobileV2.css";

const NAV_ITEMS: Array<{ id: MobileTab; label: string }> = [
  { id: "home", label: "Home" },
  { id: "arsenal", label: "Arsenal" },
  { id: "presets", label: "Presets" },
  { id: "social", label: "Social" },
  { id: "profile", label: "Profile" },
];

export default function MobileAppV2() {
  const data = useData();
  const {
    activeAccount,
    accounts,
    agents,
    handleAddNewAccount,
    handleDeleteAccount,
    handleSwitchAccount,
    isTokenExpired,
    isClientHealthy,
    loading,
    playerCards,
    refreshAccountToken,
  } = data;
  const [tab, setTab] = useState<MobileTab>("home");
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferences, setPreferences] = useState(loadMobilePreferences);
  const [cardId, setCardId] = useState("");
  const [liveMatch, setLiveMatch] = useState<LiveMatchResponse | null | undefined>(undefined);
  const [profileTarget, setProfileTarget] = useState<MobileProfileTarget | null>(null);
  const [socialTarget, setSocialTarget] = useState<MobileProfileTarget | null>(null);
  const [socialUnread, setSocialUnread] = useState(0);
  const [cosmeticEditorTarget, setCosmeticEditorTarget] = useState<MobileCosmeticEditorTarget | null>(null);
  const [renewingPuuid, setRenewingPuuid] = useState("");
  const [renewError, setRenewError] = useState("");
  const [error, setError] = useState("");
  const [homeReadyAccount, setHomeReadyAccount] = useState("");
  const [preloadStage, setPreloadStage] = useState(0);
  const subpageOpen = liveMatch !== undefined || Boolean(profileTarget);

  useEffect(() => {
    saveMobilePreferences(preferences);
  }, [preferences]);

  const handleHomeInitialLoadSettled = useCallback((accountPuuid: string) => {
    setHomeReadyAccount(accountPuuid);
  }, []);

  const selectTab = useCallback((nextTab: MobileTab) => {
    if (nextTab === tab) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setTab(nextTab);
  }, [tab]);

  useEffect(() => {
    if (!activeAccount) return;
    void getPlayerLoadoutData().then((value) => setCardId(value.identity?.playerCardId || "")).catch(() => undefined);
  }, [activeAccount]);

  useEffect(() => {
    setSocialUnread(0);
  }, [activeAccount?.puuid]);

  useEffect(() => {
    if (!activeAccount || homeReadyAccount !== activeAccount.puuid) {
      setPreloadStage(0);
      return;
    }
    const timers = [
      window.setTimeout(() => setPreloadStage(1), 250),
      window.setTimeout(() => setPreloadStage(2), 700),
      window.setTimeout(() => setPreloadStage(3), 1_200),
      window.setTimeout(() => setPreloadStage(4), 1_900),
    ];
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeAccount, homeReadyAccount]);

  useEffect(() => {
    if (!subpageOpen) return;
    window.history.pushState({ vvAndroidSubpage: true }, "");
    const close = () => {
      setLiveMatch(undefined);
      setProfileTarget(null);
    };
    window.addEventListener("popstate", close, { once: true });
    return () => window.removeEventListener("popstate", close);
  }, [subpageOpen]);

  useEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [liveMatch, profileTarget, tab]);

  useEffect(() => {
    if (!activeAccount || homeReadyAccount !== activeAccount.puuid || tab !== "home") return;
    const reset = () => {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      window.scrollTo(0, 0);
    };
    reset();
    const frame = window.requestAnimationFrame(reset);
    const timer = window.setTimeout(reset, 450);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [activeAccount, homeReadyAccount, tab]);

  const renewAccount = async (account: RiotAccount) => {
    if (renewingPuuid) return;
    setRenewingPuuid(account.puuid);
    setRenewError("");
    try {
      const renewed = await refreshAccountToken(account, true, true);
      if (!renewed) setRenewError("Riot did not renew this session. Retry and complete sign-in if Riot asks.");
    } catch (reason) {
      setRenewError(reason instanceof Error ? reason.message : "Account renewal failed.");
    } finally {
      setRenewingPuuid("");
    }
  };

  const avatar = mobileAvatar(cardId, playerCards);
  const accountName = activeAccount ? `${activeAccount.gameName}#${activeAccount.tagLine}` : "";
  const secondaryPagesReady = Boolean(activeAccount && homeReadyAccount === activeAccount.puuid);
  const tabPages = (
    <div className="mv2-tab-pages">
      <section className="mv2-tab-panel" hidden={tab !== "home"}>
        <MobileHomeV2
          key={activeAccount?.puuid}
          isActive={tab === "home" && !subpageOpen}
          onOpenLiveMatch={setLiveMatch}
          onOpenCosmeticEditor={(target) => {
            setCosmeticEditorTarget(target);
            setTab("presets");
          }}
          onInitialLoadSettled={handleHomeInitialLoadSettled}
          preferences={preferences}
        />
      </section>
      {activeAccount ? (
        <>
          {tab === "arsenal" || (secondaryPagesReady && preloadStage >= 2) ? <section className="mv2-tab-panel" hidden={tab !== "arsenal"}><MobileArsenalV2 key={activeAccount.puuid} /></section> : null}
          {tab === "presets" || (secondaryPagesReady && preloadStage >= 3) ? <section className="mv2-tab-panel" hidden={tab !== "presets"}>
            <MobilePresetsV2
              key={activeAccount.puuid}
              initialEditor={cosmeticEditorTarget}
              onInitialEditorConsumed={() => setCosmeticEditorTarget(null)}
            />
          </section> : null}
          {tab === "social" || (secondaryPagesReady && preloadStage >= 1) ? <section className="mv2-tab-panel" hidden={tab !== "social"}>
            <MobileSocialV2
              key={activeAccount?.puuid}
              onOpenLiveMatch={setLiveMatch}
              initialTarget={socialTarget}
              onInitialTargetConsumed={() => setSocialTarget(null)}
              onOpenProfile={setProfileTarget}
              onUnreadCountChange={setSocialUnread}
            />
          </section> : null}
          {tab === "profile" || (secondaryPagesReady && preloadStage >= 4) ? <section className="mv2-tab-panel" hidden={tab !== "profile"}><MobileProfileV2 isActive={tab === "profile" && !subpageOpen} onOpenProfile={setProfileTarget} /></section> : null}
        </>
      ) : null}
    </div>
  );
  const page = profileTarget ? (
    <MobileProfileV2
      target={profileTarget}
      onBack={() => setProfileTarget(null)}
      onOpenProfile={setProfileTarget}
      onMessage={(target) => {
        setProfileTarget(null);
        setSocialTarget(target);
        setTab("social");
      }}
    />
  ) : liveMatch !== undefined ? (
    <MobileLiveMatchPage match={liveMatch} agents={agents} onBack={() => setLiveMatch(undefined)} onProfile={setProfileTarget} />
  ) : tabPages;

  if (loading) return <MobileLoadingV2 />;
  if (!activeAccount) return <MobileSignInV2 onConnected={handleAddNewAccount} />;

  const homeIsStarting = homeReadyAccount !== activeAccount.puuid;

  return (
    <div className="mv2-app">
      {tab === "home" && !subpageOpen ? (
        <header className="mv2-app-bar">
          <div>
            <img src="/brand-mark.svg" alt="" />
            <span><small>VantaVault</small><strong>Home</strong></span>
          </div>
          <button
            type="button"
            className={isTokenExpired ? "needs-renewal" : ""}
            onClick={() => {
              setRenewError("");
              setAccountOpen(true);
            }}
            aria-label={`Account menu for ${accountName}${isTokenExpired ? ", renewal required" : ""}`}
          >
            {avatar ? <img src={avatar} alt="" /> : activeAccount.gameName.slice(0, 1).toUpperCase()}
          </button>
        </header>
      ) : null}
      {error ? <div className="mv2-global-error">{error}<button type="button" onClick={() => setError("")}><MobileIcon name="close" /></button></div> : null}
      <main className={`mv2-page${tab === "home" && !subpageOpen ? "" : " mv2-page-status-safe"}`}>{page}</main>

      {!subpageOpen ? (
        <nav className="mv2-bottom-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map((item) => (
            <button
              type="button"
              className={tab === item.id ? "active" : ""}
              key={item.id}
              onClick={() => selectTab(item.id)}
              aria-current={tab === item.id ? "page" : undefined}
              aria-label={item.id === "social" && socialUnread ? `Social, ${socialUnread} unread message${socialUnread === 1 ? "" : "s"}` : item.label}
            >
              <MobileIcon name={item.id} />
              {item.id === "social" && socialUnread ? <i className="mv2-nav-badge">{socialUnread > 99 ? "99+" : socialUnread}</i> : null}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {accountOpen ? (
        <MobileSheetLayer onClose={() => setAccountOpen(false)}>
          <section className="mv2-sheet mv2-account-sheet" onClick={(event) => event.stopPropagation()}>
            <i />
            <header className="mv2-sheet-heading">
              <h2>Accounts</h2>
              <button type="button" onClick={() => setAccountOpen(false)} aria-label="Close accounts"><MobileIcon name="close" /></button>
            </header>
            <p>Access renews automatically before it expires while Riot&apos;s saved session remains valid. This does not shorten the saved session.</p>
            {renewError ? <div className="mv2-inline-error">{renewError}</div> : null}
            <div className="mv2-account-list">
              {accounts.map((account) => {
                const expiresSoon = !account.expiresAt || account.expiresAt <= Date.now() + 60_000;
                const needsRepair = Boolean(account.lastRefreshError) || expiresSoon;
                const isCurrent = account.puuid === activeAccount.puuid;
                const isRenewing = renewingPuuid === account.puuid;
                return (
                  <article className={`${isCurrent ? "selected" : ""}${needsRepair ? " needs-renewal" : ""}`} key={account.puuid}>
                    <button type="button" className="mv2-account-main" onClick={() => {
                      handleSwitchAccount(account);
                      setAccountOpen(false);
                    }}>
                      <span>{account.gameName.slice(0, 1).toUpperCase()}</span>
                      <span>
                        <strong>{account.gameName}#{account.tagLine}</strong>
                        <small>
                          {isRenewing
                            ? "Renewing Riot access…"
                            : account.lastRefreshError
                              ? "Renewal needs attention"
                              : expiresSoon
                                ? "Access expired"
                                : `${isCurrent ? "Current · " : ""}Ready until ${new Date(account.expiresAt || 0).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                        </small>
                      </span>
                      {isCurrent && !needsRepair ? <MobileIcon name="check" /> : null}
                    </button>
                    {needsRepair ? (
                      <button type="button" className="mv2-account-renew" onClick={() => void renewAccount(account)} disabled={Boolean(renewingPuuid)}>
                        <MobileIcon name="refresh" size={16} />
                        {isRenewing ? "Renewing…" : account.lastRefreshError ? "Repair" : "Renew"}
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
            <button type="button" className="mv3-account-settings" onClick={() => { setAccountOpen(false); setSettingsOpen(true); }}>
              <span><MobileIcon name="settings" /></span>
              <span><strong>Settings and data</strong><small>Home layout, cache and connection health</small></span>
              <MobileIcon name="chevron" size={18} />
            </button>
            <button type="button" className="mv2-sheet-action" onClick={async () => {
              setAccountOpen(false);
              try {
                handleAddNewAccount(await data.startLoginFlow());
              } catch (reason) {
                const text = reason instanceof Error ? reason.message : String(reason);
                if (!/cancel/i.test(text)) setError(text);
              }
            }}><MobileIcon name="plus" />Add Riot account</button>
            <button type="button" className="mv2-sheet-danger" onClick={async () => {
              try {
                await handleDeleteAccount(activeAccount.puuid);
                setAccountOpen(false);
              } catch {
                // DataContext already surfaced the cleanup failure.
              }
            }}>Remove current account</button>
          </section>
        </MobileSheetLayer>
      ) : null}
      <MobileSettingsV2
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        preferences={preferences}
        onPreferencesChange={setPreferences}
        backendOnline={data.isBackendOnline}
        riotConnected={isClientHealthy}
        accounts={accounts}
        activeAccount={activeAccount}
      />
      {homeIsStarting ? <MobileLoadingV2 /> : null}
    </div>
  );
}
