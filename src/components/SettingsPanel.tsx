import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, Variants, AnimatePresence } from "framer-motion";
import { MOTION } from "../config/motionTokens";
import { Switch } from "./ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Button } from "./ui/button";
import SettingsCard from "./SettingsCard";
import SfIcon from "./icons/SfIcon";
import { signOut as supaSignOut, getSupabase } from "../lib/supabaseClient";
import { subscribeUserIdentity, initUserIdentity } from "../state/userIdentity";
import { subscribeQuota, type QuotaState } from "../state/quotaCache";
import { usePanelAutoHeight } from "../hooks/usePanelAutoHeight";
import TranscriptionHistoryView from "./TranscriptionHistoryView";

// --- Animation Variants --- //
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const sectionVariants: Variants = {
  hidden: { y: 8, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", ...MOTION.springs.quick },
  },
};

// --- Clean Spoke Components --- //
const Toggle: React.FC<{
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  inGroup?: boolean;
}> = ({ enabled, onChange, label, description, icon, disabled, inGroup }) => (
  <SettingsCard title={label} description={description} icon={icon} inGroup={inGroup}>
    <Switch checked={enabled} onCheckedChange={onChange} disabled={disabled} />
  </SettingsCard>
);

const SelectField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  description?: string;
  inGroup?: boolean;
}> = ({ value, onChange, options, label, description, inGroup }) => (
  <SettingsCard
    title={label}
    description={description}
    icon={<SfIcon name="microphone.fill" size={16} className="text-primary/70" />}
    inGroup={inGroup}
  >
    <div className="ml-2">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </SettingsCard>
);

// Cleaned out legacy row components; cards are now the single layout primitive

export const SectionSeparator: React.FC<{
  title: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ title, className = "mt-0", style }) => (
  <div
    className={`relative ${className}`}
    style={{
      marginBottom: "var(--panel-heading-gap)",
      ...(style ?? {}),
    }}
  >
    <div className="border-b-2 border-border/40" />
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="bg-background px-3 text-[10px] font-medium text-muted-foreground tracking-wider uppercase">
        {title}
      </span>
    </div>
  </div>
);

// --- Main Component --- //
interface SettingsPanelProps {
  embeddedMode?: boolean; // When true, removes drag region and adjusts layout for pill
  onToggleFloatingBar?: (enabled: boolean) => void;
  onRequestCollapse?: () => void; // Ask parent to collapse (so system sheets are visible)
  shareTranscriptionsEnabled?: boolean;
  shareTranscriptionsLoading?: boolean;
  shareTranscriptionsUpdating?: boolean;
  onShareTranscriptionsChange?: (enabled: boolean) => void;
  onHeightChange?: (height: number) => void;
  initialTab?: "settings" | "history"; // Initial tab to show (for paste-shortcut → history UX)
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  embeddedMode = false,
  onToggleFloatingBar,
  onRequestCollapse: _onRequestCollapse, // Preserved for API compatibility; sign-out flow now handled by auth state machine
  shareTranscriptionsEnabled,
  shareTranscriptionsLoading,
  shareTranscriptionsUpdating,
  onShareTranscriptionsChange,
  onHeightChange,
  initialTab = "settings",
}) => {
  // State
  const [activeTab, setActiveTab] = useState<"settings" | "history">(initialTab);

  // Sync activeTab when initialTab prop changes (e.g., on re-expand with paste timing)
  const prevInitialTabRef = useRef(initialTab);
  useEffect(() => {
    if (prevInitialTabRef.current !== initialTab) {
      setActiveTab(initialTab);
      prevInitialTabRef.current = initialTab;
    }
  }, [initialTab]);

  const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [selectedMicId, setSelectedMicId] = useState<string>("default");
  const [showFloatingBar, setShowFloatingBar] = useState<boolean>(true);
  const [showInDock, setShowInDock] = useState<boolean>(true);
  const [appVersion, setAppVersion] = useState<string>("");
  // Auth state from centralized user identity cache
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);
  // Subscription/quota state for tier-based UI
  const [quotaState, setQuotaState] = useState<QuotaState | null>(null);

  // Load app version from main via preload bridge
  useEffect(() => {
    (async () => {
      try {
        const v = await window.app?.getVersion?.();
        if (v && typeof v === "string") setAppVersion(v);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Initialize from main visibility state (source of truth)
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        // Prefer persisted intent if available; fallback to current visibility
        const pref = await window.electron?.getFloatingBarEnabled?.();
        if (pref && typeof pref.enabled === "boolean") {
          if (isMounted) setShowFloatingBar(pref.enabled);
        } else {
          const vis = await window.electron?.isFloatingBarVisible?.();
          if (vis && typeof vis.visible === "boolean") {
            if (isMounted) setShowFloatingBar(vis.visible);
          }
        }
      } catch { }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // Initialize dock visibility from main process
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const result = await window.electron?.getDockVisible?.();
        if (result && typeof result.visible === "boolean") {
          if (isMounted) setShowInDock(result.visible);
        }
      } catch { }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // Subscribe to centralized user identity cache
  useEffect(() => {
    // Initialize user identity (loads from cache immediately, then fetches from DB)
    initUserIdentity().then((identity) => {
      setUserEmail(identity.email);
      setUserName(identity.name);
    }).catch((): null => null);

    // Subscribe to identity changes (handles sign-in/sign-out automatically)
    const unsubscribe = subscribeUserIdentity((identity) => {
      setUserEmail(identity.email);
      setUserName(identity.name);
    });

    return unsubscribe;
  }, []);

  // Subscribe to quota/subscription state for tier-based UI
  useEffect(() => {
    const unsubscribe = subscribeQuota((quota) => {
      setQuotaState(quota);
    });
    return unsubscribe;
  }, []);

  // Listen for microphone device updates and selection changes
  useEffect(() => {
    const updateDeviceList = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices
          .filter((device) => device.kind === "audioinput")
          .map((device) => ({
            id: device.deviceId,
            label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`,
          }));

        setMicDevices(audioInputs);
      } catch (err) {
        console.error("[SettingsPanel] Failed to enumerate devices:", err);
        setMicDevices([]);
      }
    };

    updateDeviceList();
    navigator.mediaDevices.addEventListener("devicechange", updateDeviceList);

    let unsubscribe: (() => void) | undefined;
    if (window.mic?.onSelectedChanged) {
      unsubscribe = window.mic.onSelectedChanged(({ id }) => {
        if (id && typeof id === "string") {
          setSelectedMicId(id);
        }
      });
    }

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        updateDeviceList,
      );
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  // Language selection removed for a simpler defaults experience

  const micOptions = useMemo(
    () =>
      micDevices.map((device) => ({
        value: device.id,
        label: device.label,
      })),
    [micDevices],
  );

  const handleMicChange = (deviceId: string) => {
    setSelectedMicId(deviceId);
    if (window.mic?.select) {
      window.mic.select(deviceId);
    }
  };

  // Initial mic selection + passive refresh (focus + visibility while open)
  useEffect(() => {
    const initSelectedMic = async () => {
      try {
        const res = await window.mic?.getSelected?.();
        if (res?.id) setSelectedMicId(res.id);
      } catch (e) {
        // ignore
      }
    };
    initSelectedMic();

    const handleFocus = () => {
      initSelectedMic();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        initSelectedMic();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  const handleSignOut = async () => {
    if (isSigningOut) return; // Prevent double-clicks
    setIsSigningOut(true);

    try {
      // Sign out and wait for completion
      // The onAuthStateChange listener in App.tsx will:
      // 1. Send "Signed out" notification (which transitions pill from EXPANDED → NOTIFICATION)
      // 2. Set pendingHideAfterCollapse to show onboarding after notification
      await supaSignOut();

      // Note: We don't call onRequestCollapse() here because the NOTIFY event
      // from the auth state change handler will transition the pill out of EXPANDED state.
      // The pendingHideAfterCollapse logic then handles hiding and showing onboarding.
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to sign out:", msg);
      setIsSigningOut(false); // Reset on error so user can retry
    }
    // Don't reset isSigningOut on success - component will unmount anyway
  };

  const handleManageSubscription = async () => {
    // Open browser immediately - website handles the redirect
    // This provides instant feedback rather than waiting for API response in the app
    try {
      const supabase = await getSupabase();
      if (!supabase) {
        console.error("[Settings] Supabase client not available");
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        console.error("[Settings] No session found for billing portal");
        return;
      }

      // Open the redirect page with token in hash fragment (not sent to server logs)
      // The website page will read the token, call the API, and redirect to Dodo
      const portalUrl = `https://www.spoke.so/billing/portal#token=${session.access_token}`;
      window.electron?.openExternal(portalUrl);
    } catch (error) {
      console.error("[Settings] Error opening billing portal:", error);
    }
  };

  // Remove login handling from Settings Panel: onboarding is the sole login surface

  // Ensure interactive cursor and events work in embedded (expanded) mode
  useEffect(() => {
    if (embeddedMode) {
      window.electron?.setClickThrough(false);
    }
    // No explicit cleanup; outer FSM restores click-through when collapsing
  }, [embeddedMode]);

  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  usePanelAutoHeight(contentRef, embeddedMode ? onHeightChange : undefined);

  // Scroll indicator state
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Update scroll indicators
  const updateScrollIndicators = () => {
    const el = scrollRef.current;
    if (!el) return;

    setCanScrollUp(el.scrollTop > 0);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  };

  // Check scroll state on mount and when tab changes
  useEffect(() => {
    // Small delay to ensure content is rendered
    const timer = setTimeout(updateScrollIndicators, 50);
    return () => clearTimeout(timer);
  }, [activeTab]);

  return (
    <div
      className={`${embeddedMode ? "min-h-0" : "h-screen"} bg-background text-foreground flex flex-col relative`}
    >
      {/* Version text on bottom-right (embedded mode) */}
      {embeddedMode && appVersion && (
        <a
          href="https://spoke.so/changelog"
          onClick={(e) => {
            e.preventDefault();
            window.electron?.openExternal?.("https://spoke.so/changelog");
          }}
          className="absolute right-4 bottom-3 text-[10px] text-muted-foreground opacity-70 whitespace-nowrap cursor-pointer hover:opacity-95 transition-opacity duration-200 z-30"
        >
          Spoke Beta {appVersion}
        </a>
      )}

      {/* Draggable Header - only show in standalone mode */}
      {!embeddedMode && (
        <div className="border-b border-border/40 bg-background flex-shrink-0 drag-region">
          <div className="h-6" />
        </div>
      )}

      {/* Content container for height measurement - includes navbar */}
      <div ref={contentRef}>
        {/* Tab Navigation - top bezel */}
        <div className="bg-background flex-shrink-0 no-drag" style={{ paddingTop: "var(--nav-bar-padding-top)", paddingBottom: "6px" }}>
          <div className="flex items-center justify-center px-6">
            <div className="flex items-center gap-0.5 border border-white/[0.08] rounded-lg p-1">
              <button
                onClick={() => setActiveTab("settings")}
                style={{ transition: 'background-color 200ms ease-out, color 200ms ease-out' }}
                className={`relative flex items-center gap-0 p-2 rounded-md min-w-[42px] ${activeTab === "settings" ? "" : "justify-center"} ${activeTab === "settings"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
              >
                {activeTab === "settings" && (
                  <motion.div
                    key="settings-bg"
                    className="absolute inset-0 bg-white/10 rounded-md"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  />
                )}
                <span className="relative z-10 flex items-center justify-center w-[17px] flex-shrink-0" style={{ transition: 'color 200ms ease-out' }}>
                  <SfIcon name="gearshape.fill" size={17} />
                </span>
                <motion.span
                  animate={{
                    opacity: activeTab === "settings" ? 1 : 0,
                    width: activeTab === "settings" ? "auto" : 0,
                    marginLeft: activeTab === "settings" ? "8px" : "0px"
                  }}
                  transition={{
                    opacity: { duration: activeTab === "settings" ? 0.25 : 0.12 },
                    width: { duration: activeTab === "settings" ? 0.25 : 0.12, ease: activeTab === "settings" ? [0.34, 1.56, 0.64, 1] : [0.4, 0, 1, 1] },
                    marginLeft: { duration: activeTab === "settings" ? 0.25 : 0.12, ease: activeTab === "settings" ? [0.34, 1.56, 0.64, 1] : [0.4, 0, 1, 1] }
                  }}
                  className="relative z-10 text-[11px] font-medium overflow-hidden whitespace-nowrap"
                >
                  Settings
                </motion.span>
              </button>
              <button
                onClick={() => setActiveTab("history")}
                style={{ transition: 'background-color 200ms ease-out, color 200ms ease-out' }}
                className={`relative flex items-center gap-0 p-2 rounded-md min-w-[42px] ${activeTab === "history" ? "" : "justify-center"} ${activeTab === "history"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
              >
                {activeTab === "history" && (
                  <motion.div
                    key="history-bg"
                    className="absolute inset-0 bg-white/10 rounded-md"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  />
                )}
                <span className="relative z-10 flex items-center justify-center w-[17px] flex-shrink-0" style={{ transition: 'color 200ms ease-out' }}>
                  <SfIcon name="clock.arrow.trianglehead.counterclockwise.rotate.90" size={17} />
                </span>
                <motion.span
                  animate={{
                    opacity: activeTab === "history" ? 1 : 0,
                    width: activeTab === "history" ? "auto" : 0,
                    marginLeft: activeTab === "history" ? "8px" : "0px"
                  }}
                  transition={{
                    opacity: { duration: activeTab === "history" ? 0.25 : 0.12 },
                    width: { duration: activeTab === "history" ? 0.25 : 0.12, ease: activeTab === "history" ? [0.34, 1.56, 0.64, 1] : [0.4, 0, 1, 1] },
                    marginLeft: { duration: activeTab === "history" ? 0.25 : 0.12, ease: activeTab === "history" ? [0.34, 1.56, 0.64, 1] : [0.4, 0, 1, 1] }
                  }}
                  className="relative z-10 text-[11px] font-medium overflow-hidden whitespace-nowrap"
                >
                  History
                </motion.span>
              </button>
            </div>
          </div>
        </div>

        {/* Scrollable Content - the screen */}
        <div className="relative flex-1">
          {/* Top fade gradient - dynamic */}
          <div
            className="absolute top-0 left-0 right-0 h-12 pointer-events-none z-20 transition-opacity duration-200"
            style={{
              background: "linear-gradient(to bottom, hsl(var(--background)), transparent)",
              opacity: canScrollUp ? 1 : 0,
            }}
          />
          <div
            ref={scrollRef}
            className="overflow-y-auto h-full scrollbar-hide"
            style={{ maxHeight: "530px" }}
            onScroll={updateScrollIndicators}
          >
            <div
              className="max-w-lg mx-auto w-full px-5 pt-0 pb-14"
            >
              {activeTab === "settings" ? (
                <motion.div
                  initial="hidden"
                  animate="visible"
                  variants={containerVariants}
                  className="flex flex-col"
                >
                  {/* Section 0: Usage (only shown for free users) */}
                  {quotaState && !quotaState.isPro && userEmail && (
                    <motion.section
                      variants={sectionVariants}
                      className="space-y-2"
                      style={{ marginTop: "var(--panel-section-offset)" }}
                    >
                      <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-background p-4">
                        {/* Header row with title and word count */}
                        <div className="flex items-baseline justify-between mb-3">
                          <div className="flex items-end gap-1">
                            <span className="text-xs font-medium text-white/90 leading-none">
                              Usage
                            </span>
                            <span className="text-[9px] text-white/30 font-normal leading-none">
                              resets monthly
                            </span>
                          </div>
                          <span className="text-[11px] text-white/50 tabular-nums">
                            {quotaState.wordsUsed.toLocaleString()} / {quotaState.limit.toLocaleString()}
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="h-1 bg-white/[0.06] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-white/70 rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(100, (quotaState.wordsUsed / quotaState.limit) * 100)}%`,
                            }}
                          />
                        </div>
                        {quotaState.wordsUsed >= quotaState.limit && (
                          <div className="text-[10px] text-white/40 mt-2.5">
                            Quota reached. Upgrade for unlimited dictation.
                          </div>
                        )}
                      </div>
                    </motion.section>
                  )}

                  {/* Section 1: Defaults */}
                  <motion.section
                    variants={sectionVariants}
                    className="space-y-4"
                    style={{ marginTop: "var(--panel-section-offset)" }}
                  >
                    <SectionSeparator title="Defaults" />

                    <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-background no-drag [&>*:last-child]:border-b-0">
                      <SelectField
                        label="Microphone"
                        description="Select your preferred input device"
                        value={selectedMicId}
                        onChange={handleMicChange}
                        options={micOptions}
                        inGroup
                      />

                      <Toggle
                        label="Show Floating Bar"
                        description="Display the floating dictation bar"
                        enabled={showFloatingBar}
                        onChange={(enabled) => {
                          setShowFloatingBar(enabled);
                          if (onToggleFloatingBar) onToggleFloatingBar(enabled);
                        }}
                        icon={
                          <SfIcon
                            name="eye.fill"
                            size={16}
                            className="text-primary/70"
                          />
                        }
                        inGroup
                      />

                      <Toggle
                        label="Show in Dock"
                        description="Display app icon in the macOS Dock"
                        enabled={showInDock}
                        onChange={async (enabled) => {
                          setShowInDock(enabled);
                          try {
                            await window.electron?.setDockVisible?.(enabled);
                          } catch (error) {
                            console.error("[Settings] Failed to set dock visibility:", error);
                          }
                        }}
                        icon={
                          <SfIcon
                            name="dock.rectangle"
                            size={16}
                            className="text-primary/70"
                          />
                        }
                        inGroup
                      />

                      {/* Temporarily hidden - can be restored later */}
                      {/* <Toggle
                        label="Improve the Model for Everyone"
                        description="Share anonymous usage to improve responses"
                        enabled={shareTranscriptionsEnabled ?? false}
                        onChange={(enabled) => onShareTranscriptionsChange?.(enabled)}
                        icon={
                          <SfIcon
                            name="point.3.filled.connected.trianglepath.dotted"
                            size={16}
                            className="text-primary/70"
                          />
                        }
                        disabled={
                          !!shareTranscriptionsLoading || !!shareTranscriptionsUpdating
                        }
                        inGroup
                      /> */}
                    </div>
                  </motion.section>

                  {/* Section 3: Account */}
                  <motion.section
                    variants={sectionVariants}
                    className="space-y-4"
                    style={{ marginTop: "var(--panel-section-offset)" }}
                  >
                    <SectionSeparator title="Account" />
                    <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-background [&>*:last-child]:border-b-0">
                      {userEmail ? (
                        <div className={`relative overflow-hidden ${quotaState?.isPro ? 'shimmer' : ''}`}>
                          <div className="p-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              {/* Avatar with optional PRO badge */}
                              <div className="relative shrink-0">
                                <div className="w-8 h-8 rounded-[var(--radius-md)] card-floating flex items-center justify-center">
                                  <span className="text-[11px] font-semibold tracking-wide">
                                    {(userName || userEmail || "").slice(0, 1).toUpperCase()}
                                  </span>
                                </div>
                                {/* PRO badge - only shown for Pro users */}
                                {quotaState?.isPro && (
                                  <div
                                    className="absolute -top-1 -right-1.5 text-white/90 text-[6px] font-bold px-1.5 py-0.5 rounded leading-none border border-white/10"
                                    style={{
                                      background: 'linear-gradient(135deg, rgba(60, 60, 60, 0.9) 0%, rgba(40, 40, 40, 0.95) 100%)',
                                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
                                    }}
                                  >
                                    PRO
                                  </div>
                                )}
                              </div>
                              {/* Name */}
                              <div className="text-left min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-medium text-white truncate">
                                    {userName || userEmail}
                                  </span>
                                </div>
                                {userEmail && (
                                  <div className="text-[10px] text-subtle mt-0.5 truncate">
                                    {userEmail}
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Buttons - Manage for Pro, Upgrade for Free */}
                            <div className="flex items-center gap-2 shrink-0 no-drag">
                              {quotaState?.isPro ? (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={handleManageSubscription}
                                >
                                  Manage
                                </Button>
                              ) : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => window.electron?.openExternal?.("https://spoke.so/pricing")}
                                  className="relative overflow-hidden shimmer-fast"
                                >
                                  Upgrade
                                </Button>
                              )}
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleSignOut}
                                disabled={isSigningOut}
                                className="!w-9 !px-0 flex items-center justify-center"
                              >
                                <SfIcon name="rectangle.portrait.and.arrow.right" size={16} className="text-white/60" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        // If not signed in, do not render login UI here — redirect to onboarding
                        <div className="p-3">
                          <div className="text-[12px] text-subtle mb-3">
                            You are signed out.
                          </div>
                          <Button
                            className="w-full onboarding-cta"
                            onClick={async () => {
                              try {
                                await window.electron?.showOnboarding?.();
                              } catch { }
                            }}
                          >
                            Open Onboarding to Sign In
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.section>

                </motion.div>
              ) : (
                <TranscriptionHistoryView />
              )}
            </div>
          </div>
        </div>

        {/* Fixed bottom band - bezel with footer and chevron space */}
        <div className="absolute bottom-0 left-0 right-0 z-20 bg-background">
          {/* Bottom fade gradient - dynamic */}
          <div
            className="absolute -top-12 left-0 right-0 h-12 pointer-events-none transition-opacity duration-200"
            style={{
              background: "linear-gradient(to bottom, transparent, hsl(var(--background)))",
              opacity: canScrollDown ? 1 : 0,
            }}
          />
          {/* Band content with footer */}
          <div className="px-5 pt-8 pb-4">
            {!embeddedMode && (
              <div className="flex items-center justify-center gap-2">
                <img
                  src="/assets/TrayTemplate.png"
                  alt="Spoke Icon"
                  className="w-4 h-4 brightness-0 invert"
                />
                <p className="text-[10px] text-muted-foreground opacity-70">{appVersion ? `Spoke Beta ${appVersion}` : ""}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div >
  );
};

export default React.memo(SettingsPanel);
