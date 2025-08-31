import React, { useState, useEffect, useMemo } from "react";
import { useIntervalManager } from "../hooks/useIntervalManager";
import { motion, Variants } from "framer-motion";
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
import { getCurrentUser, signOut as supaSignOut } from "../lib/supabaseClient";
import { usePermissions } from "../hooks/usePermissions";

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

// --- Clean Sonic Flow Components --- //
const Toggle: React.FC<{
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}> = ({ enabled, onChange, label, description, icon }) => (
  <SettingsCard title={label} description={description} icon={icon}>
    <Switch checked={enabled} onCheckedChange={onChange} />
  </SettingsCard>
);

const SelectField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  description?: string;
}> = ({ value, onChange, options, label, description }) => (
  <SettingsCard
    title={label}
    description={description}
    icon={<SfIcon name="mic.fill" size={16} className="text-primary/70" />}
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

const SectionSeparator: React.FC<{ title: string }> = ({ title }) => (
  <div className="relative my-6">
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
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  embeddedMode = false,
  onToggleFloatingBar,
}) => {
  // State
  const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [selectedMicId, setSelectedMicId] = useState<string>("default");
  const [showFloatingBar, setShowFloatingBar] = useState<boolean>(true);
  const [playSounds, setPlaySounds] = useState<boolean>(true);
  // Auth state for settings panel
  // Remove inline login from Settings Panel — this surface should only show when signed in
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  // Avatar URL available in metadata, not currently displayed in UI
  const [authReady, setAuthReady] = useState(false);

  // Permissions (deduplicated via shared hook)
  const { permissions, ui, init: initPermissions, requestMicrophone, requestAccessibility, requestInputMonitoring } =
    usePermissions(undefined, { pollIntervalMs: 1000, deepLinkGraceMs: 4000 });
  const { cancelAll } = useIntervalManager();

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
      } catch {}
      try {
        const storedPlay = localStorage.getItem("sf.playSounds");
        if (storedPlay != null && isMounted) setPlaySounds(storedPlay === "true");
      } catch {}
      try {
        // Initialize auth view – optimistic seed from cache to reduce flicker
        const cachedEmail = localStorage.getItem("sf.lastUserEmail");
        if (cachedEmail && isMounted) setUserEmail(cachedEmail);
        // Fast path: hydrate from local session first to avoid UI flicker
        try {
          const { getSupabase } = await import("../lib/supabaseClient");
          const sb = getSupabase();
          const sess = await sb?.auth.getSession();
          const fastUser = sess?.data.session?.user;
          if (fastUser && isMounted) {
            setUserEmail(fastUser.email ?? null);
            const md = fastUser.user_metadata as unknown as {
              name?: string;
              avatar_url?: string;
            };
            setUserName(md?.name ?? null);
            // avatar_url available via md if needed for future UI
            if (fastUser.email)
              localStorage.setItem("sf.lastUserEmail", fastUser.email);
          }
        } catch {}
        // Authoritative fetch
        const u = await getCurrentUser();
        if (u && isMounted) {
          setUserEmail(u.email ?? null);
          const md = u.user_metadata as unknown as {
            name?: string;
            avatar_url?: string;
          };
          setUserName(md?.name ?? null);
          // avatar_url available via md if needed for future UI
          if (u.email) localStorage.setItem("sf.lastUserEmail", u.email);
        } else if (isMounted) {
          setUserEmail(null);
          setUserName(null);
        }
        if (isMounted) setAuthReady(true);
      } catch {
        if (isMounted) setAuthReady(true);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, []);

  // If not signed in, automatically route to onboarding
  useEffect(() => {
    if (!authReady) return;
    if (!userEmail) {
      (async () => {
        try {
          await window.electron?.showOnboarding?.();
        } catch {}
      })();
    }
  }, [authReady, userEmail]);

  // Minimal auth state hydration listener
  useEffect(() => {
    // Lazy import to avoid adding supabase client to this component directly
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        const { getSupabase } = await import("../lib/supabaseClient");
        const supabase = getSupabase();
        if (!supabase) return;
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, session) => {
          const u = session?.user;
          if (u) {
            setUserEmail(u.email ?? null);
            const md = u.user_metadata as unknown as {
              name?: string;
              avatar_url?: string;
            };
            setUserName(md?.name ?? null);
            // avatar_url available via md if needed for future UI
            if (u.email) localStorage.setItem("sf.lastUserEmail", u.email);
          } else {
            setUserEmail(null);
            setUserName(null);
          }
          setAuthReady(true);
        });
        unsubscribe = () => subscription.unsubscribe();
      } catch {}
    })();
    return () => {
      unsubscribe && unsubscribe();
    };
  }, []);

  // Persist preferences when they change
  useEffect(() => {
    try {
      localStorage.setItem("sf.playSounds", String(playSounds));
    } catch {}
  }, [playSounds]);

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

  // Initial permission check + initial mic selection + passive refresh (focus + 5s interval while open)
  useEffect(() => {
    const initPerms = async () => {
      try {
        await initPermissions();
      } catch (e) {
        // ignore
      }
    };
    const initSelectedMic = async () => {
      try {
        const res = await window.mic?.getSelected?.();
        if (res?.id) setSelectedMicId(res.id);
      } catch (e) {
        // ignore
      }
    };
    initPerms();
    initSelectedMic();

    const handleFocus = () => {
      initPerms();
      initSelectedMic();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        initPerms();
        initSelectedMic();
      }
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      // Cleanup all scheduled intervals (centralized)
      cancelAll();
      // Permission polling is managed by usePermissions; no local timers to clear

      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  // Permission handlers
  const handleRequestMicrophone = async () => { await requestMicrophone(); };
  const handleRequestAccessibility = async () => { await requestAccessibility(); };
  const handleRequestInputMonitoring = async () => { await requestInputMonitoring(); };

  const handleSignOut = () => {
    (async () => {
      try {
        await supaSignOut();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Failed to sign out:", msg);
      }
      // Regardless of signOut outcome, route user into onboarding and hide the pill
      try {
        await window.electron?.hideFloatingBarIndefinitely?.();
      } catch {}
      try {
        await window.electron?.showOnboarding?.();
      } catch {}
      setUserEmail(null);
      setUserName(null);
      // clear any derived avatar state if used in the future
    })();
  };

  // Remove login handling from Settings Panel: onboarding is the sole login surface

  // Ensure interactive cursor and events work in embedded (expanded) mode
  useEffect(() => {
    if (embeddedMode) {
      window.electron?.setClickThrough(false);
    }
    // No explicit cleanup; outer FSM restores click-through when collapsing
  }, [embeddedMode]);

  return (
    <div
      className={`${embeddedMode ? "h-full" : "h-screen"} bg-background text-foreground flex flex-col relative`}
    >
      {/* Vertical version text on bottom-left - only in embedded mode */}
      {embeddedMode && (
        <div className="absolute left-5 bottom-4 transform -rotate-90 origin-bottom-left text-[10px] text-muted-foreground opacity-60 whitespace-nowrap">
          v0.0.1
        </div>
      )}

      {/* Draggable Header - only show in standalone mode */}
      {!embeddedMode && (
        <div className="border-b border-border/40 bg-background flex-shrink-0 drag-region">
          <div className="h-6" />
        </div>
      )}

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-5 py-4">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="space-y-4"
          >
            {/* Section 1: Defaults */}
            <motion.div variants={sectionVariants}>
              <SectionSeparator title="Defaults" />

              <div className="space-y-3 no-drag">
                <SelectField
                  label="Microphone"
                  description="Select your preferred input device"
                  value={selectedMicId}
                  onChange={handleMicChange}
                  options={micOptions}
                />

                <Toggle
                  label="Show Floating Bar"
                  description="Display the floating dictation pill"
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
                />

                <Toggle
                  label="Play Sounds"
                  description="Audio feedback for dictation start/stop"
                  enabled={playSounds}
                  onChange={setPlaySounds}
                  icon={
                    <SfIcon
                      name="speaker.wave.3.fill"
                      size={16}
                      className="text-primary/70"
                    />
                  }
                />
              </div>
            </motion.div>

            {/* Section 2: System */}
            <motion.div variants={sectionVariants}>
              <SectionSeparator title="System" />

              <div className="space-y-3">
                {/* Microphone Permission */}
                <SettingsCard
                  title="Microphone"
                  description="Capture your voice for dictation"
                  icon={
                    <SfIcon
                      name="mic.fill"
                      size={16}
                      className="text-primary/70"
                    />
                  }
                >
                  {!permissions.microphone ? (
                    <Button
                      size="sm"
                      onClick={handleRequestMicrophone}
                      disabled={ui.microphone.loading}
                      className="text-xs onboarding-cta"
                    >
                      <div className="relative flex items-center justify-center h-4 w-14">
                        {ui.microphone.loading ? (
                          <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                          <span>Enable</span>
                        )}
                      </div>
                    </Button>
                  ) : (
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      className="text-white/80"
                    >
                      <path
                        d="M5 13l4 4L19 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </SettingsCard>

                {/* Accessibility Permission */}
                <SettingsCard
                  title="Accessibility"
                  description="Insert recognized text into your apps"
                  icon={
                    <SfIcon
                      name="accessibility"
                      size={16}
                      className="text-primary/70"
                    />
                  }
                >
                  {!permissions.accessibility ? (
                    <Button
                      size="sm"
                      onClick={handleRequestAccessibility}
                      disabled={ui.accessibility.loading}
                      className="text-xs onboarding-cta"
                    >
                      <div className="relative flex items-center justify-center h-4 w-14">
                        {ui.accessibility.loading ? (
                          <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                          <span>Enable</span>
                        )}
                      </div>
                    </Button>
                  ) : (
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      className="text-white/80"
                    >
                      <path
                        d="M5 13l4 4L19 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </SettingsCard>

                {/* Input Monitoring Permission */}
                <SettingsCard
                  title="Input Monitoring"
                  description="Detect the Fn key to start and stop dictation"
                  icon={
                    <SfIcon
                      name="keyboard.badge.eye.fill"
                      size={16}
                      className="text-primary/70"
                    />
                  }
                >
                  {!permissions.inputMonitoring ? (
                    <Button
                      size="sm"
                      onClick={handleRequestInputMonitoring}
                      disabled={ui.inputMonitoring.loading}
                      className="text-xs onboarding-cta"
                    >
                      <div className="relative flex items-center justify-center h-4 w-14">
                        {ui.inputMonitoring.loading ? (
                          <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                          <span>Enable</span>
                        )}
                      </div>
                    </Button>
                  ) : (
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      className="text-white/80"
                    >
                      <path
                        d="M5 13l4 4L19 7"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </SettingsCard>
              </div>
            </motion.div>

            {/* Section 3: Account */}
            <motion.div variants={sectionVariants}>
              <SectionSeparator title="Account" />
              {userEmail ? (
                <SettingsCard
                  title={userName || userEmail}
                  description={userEmail}
                  icon={
                    <span className="text-[11px] font-semibold tracking-wide">
                      {(userName || userEmail || "").slice(0, 1).toUpperCase()}
                    </span>
                  }
                >
                  <Button variant="secondary" size="sm" onClick={handleSignOut}>
                    Sign Out
                  </Button>
                </SettingsCard>
              ) : (
                // If not signed in, do not render login UI here — redirect to onboarding
                <div className="space-y-3">
                  <div className="text-[12px] text-subtle">
                    You are signed out.
                  </div>
                  <Button
                    className="w-full onboarding-cta"
                    onClick={async () => {
                      try {
                        await window.electron?.showOnboarding?.();
                      } catch {}
                    }}
                  >
                    Open Onboarding to Sign In
                  </Button>
                </div>
              )}
            </motion.div>

            {/* Footer with logo and version - only in standalone mode */}
            {!embeddedMode && (
              <motion.footer
                variants={sectionVariants}
                className="flex items-center gap-2 pt-6 pb-3"
              >
                <img
                  src="/assets/TrayTemplate.png"
                  alt="Sonic Flow Icon"
                  className="w-4 h-4 brightness-0 invert"
                />
                <p className="text-[10px] text-muted-foreground opacity-70">
                  v0.0.1
                </p>
              </motion.footer>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SettingsPanel);
