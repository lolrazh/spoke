import React, { useState, useEffect, useMemo } from "react";
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
import { signOut as supaSignOut } from "../lib/supabaseClient";
import { subscribeUserIdentity, initUserIdentity } from "../state/userIdentity";

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
  disabled?: boolean;
}> = ({ enabled, onChange, label, description, icon, disabled }) => (
  <SettingsCard title={label} description={description} icon={icon}>
    <Switch checked={enabled} onCheckedChange={onChange} disabled={disabled} />
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
    icon={<SfIcon name="microphone.fill" size={16} className="text-primary/70" />}
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

export const SectionSeparator: React.FC<{ title: string }> = ({ title }) => (
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
  onRequestCollapse?: () => void; // Ask parent to collapse (so system sheets are visible)
  shareTranscriptionsEnabled?: boolean;
  shareTranscriptionsLoading?: boolean;
  shareTranscriptionsUpdating?: boolean;
  onShareTranscriptionsChange?: (enabled: boolean) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  embeddedMode = false,
  onToggleFloatingBar,
  onRequestCollapse,
  shareTranscriptionsEnabled,
  shareTranscriptionsLoading,
  shareTranscriptionsUpdating,
  onShareTranscriptionsChange,
}) => {
  // State
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
      } catch {}
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
      } catch {}
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
    }).catch(() => null);

    // Subscribe to identity changes (handles sign-in/sign-out automatically)
    const unsubscribe = subscribeUserIdentity((identity) => {
      setUserEmail(identity.email);
      setUserName(identity.name);
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

  const handleSignOut = () => {
    (async () => {
      try {
        // Collapse the pill first so UI returns to resting before we transition
        try { onRequestCollapse?.(); } catch {}
        // Sign out; cache will be cleared automatically by supaSignOut()
        // and userIdentity subscription will update our local state
        await supaSignOut();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Failed to sign out:", msg);
      }
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
      {/* Version text on bottom-right (embedded mode) */}
      {embeddedMode && appVersion && (
        <a
          href="https://sonicflow.app/changelog"
          onClick={(e) => {
            e.preventDefault();
            window.electron?.openExternal?.("https://sonicflow.app/changelog");
          }}
          className="absolute right-3 bottom-2 text-[10px] text-muted-foreground opacity-70 whitespace-nowrap cursor-pointer hover:opacity-95 transition-opacity duration-200"
        >
          Sonic Flow Beta {appVersion}
        </a>
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
                  />

                  <Toggle
                    label="Improve the Model for Everyone"
                    description="Share anonymous usage to improve responses"
                    enabled={shareTranscriptionsEnabled ?? false}
                    onChange={(enabled) =>
                      onShareTranscriptionsChange?.(enabled)
                    }
                    icon={
                      <SfIcon
                        name="point.3.filled.connected.trianglepath.dotted"
                        size={16}
                        className="text-primary/70"
                      />
                    }
                    disabled={
                      !!shareTranscriptionsLoading ||
                      !!shareTranscriptionsUpdating
                    }
                  />
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
                <p className="text-[10px] text-muted-foreground opacity-70">{appVersion ? `Sonic Flow Beta ${appVersion}` : ""}</p>
              </motion.footer>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SettingsPanel);
