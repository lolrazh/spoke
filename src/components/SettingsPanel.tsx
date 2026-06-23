import React, { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Switch } from "./ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "./ui/select";
import SettingsCard from "./SettingsCard";
import ModelInstallCard from "./ModelInstallCard";
import SfIcon from "./icons/SfIcon";
import { usePanelAutoHeight } from "../hooks/usePanelAutoHeight";
import TranscriptionHistoryView from "./TranscriptionHistoryView";
import {
  panelCascadeContainer,
  panelCascadeItem,
} from "./shared/panelMotion";

type SettingsPanelTab = "settings" | "models" | "history";
type SettingsPanelInitialTab = Extract<
  SettingsPanelTab,
  "settings" | "history"
>;

const DEFAULT_MIC_DEVICE = { id: "default", label: "System Default" };

type UpdatePanelState = {
  status: "idle" | "checking" | "available" | "not-available" | "error";
  version: string | null;
  readyToInstall: boolean;
  error: string | null;
};

// --- Clean Spoke Components --- //
const Toggle: React.FC<{
  // `null` means "not loaded yet" — render a placeholder instead of guessing
  // an on/off position (which would flash the wrong state).
  enabled: boolean | null;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  inGroup?: boolean;
}> = ({ enabled, onChange, label, description, icon, disabled, inGroup }) => (
  <SettingsCard
    title={label}
    description={description}
    icon={icon}
    inGroup={inGroup}
  >
    {enabled === null ? (
      <div
        className="h-5 w-10 shrink-0 rounded-[6px] bg-white/5"
        aria-hidden
      />
    ) : (
      <Switch checked={enabled} onCheckedChange={onChange} disabled={disabled} />
    )}
  </SettingsCard>
);

const SelectField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  description?: string;
  inGroup?: boolean;
  icon?: React.ReactNode;
}> = ({ value, onChange, options, label, description, inGroup, icon }) => {
  const selectedLabel =
    options.find((option) => option.value === value)?.label ??
    (value === DEFAULT_MIC_DEVICE.id ? DEFAULT_MIC_DEVICE.label : "Select…");

  return (
    <SettingsCard
      title={label}
      description={description}
      icon={
        icon ?? (
          <SfIcon
            name="microphone.fill"
            size={16}
            className="text-primary/70"
          />
        )
      }
      inGroup={inGroup}
    >
      <div className="ml-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-48">
            <span className="block truncate">{selectedLabel}</span>
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
};

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

const TabButton: React.FC<{
  active: boolean;
  iconName: string;
  label: string;
  onClick: () => void;
}> = ({ active, iconName, label, onClick }) => (
  <button
    type="button"
    aria-pressed={active}
    aria-label={label}
    onClick={onClick}
    style={{
      transition: "background-color 200ms ease-out, color 200ms ease-out",
    }}
    className={`relative flex items-center gap-0 p-2 rounded-md min-w-[42px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15 ${
      active ? "" : "justify-center"
    } ${
      active
        ? "text-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-white/5"
    }`}
  >
    {active && (
      <motion.div
        key={`${label}-bg`}
        className="absolute inset-0 bg-white/10 rounded-md"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      />
    )}
    <span
      className="relative z-10 flex items-center justify-center w-[17px] flex-shrink-0"
      style={{ transition: "color 200ms ease-out" }}
    >
      <SfIcon name={iconName} size={17} />
    </span>
    <motion.span
      initial={false}
      animate={{
        opacity: active ? 1 : 0,
        width: active ? "auto" : 0,
        marginLeft: active ? "8px" : "0px",
      }}
      transition={{
        opacity: {
          duration: active ? 0.25 : 0.12,
        },
        width: {
          duration: active ? 0.25 : 0.12,
          ease: active ? [0.34, 1.56, 0.64, 1] : [0.4, 0, 1, 1],
        },
        marginLeft: {
          duration: active ? 0.25 : 0.12,
          ease: active ? [0.34, 1.56, 0.64, 1] : [0.4, 0, 1, 1],
        },
      }}
      className="relative z-10 text-[11px] font-medium overflow-hidden whitespace-nowrap"
    >
      {label}
    </motion.span>
  </button>
);

const UpdateCapsule: React.FC<{
  updateState: UpdatePanelState | null;
  onInstallRequested: () => void;
  installRequested: boolean;
}> = ({ updateState, onInstallRequested, installRequested }) => {
  if (!updateState) return null;

  const isReady = updateState.readyToInstall;
  const isAvailable =
    updateState.status === "available" && !updateState.readyToInstall;
  const isChecking = updateState.status === "checking";
  const isError = updateState.status === "error";
  const visible = isReady || isAvailable || isChecking || isError;

  if (!visible) return null;

  const label = isReady
    ? "Restart Spoke"
    : isAvailable
      ? installRequested
        ? "Downloading"
        : "Update Available"
      : isChecking
        ? "Checking"
        : "Try Again";

  const handleClick = () => {
    if (isReady) {
      window.update?.restart?.();
      return;
    }
    if (isAvailable) {
      onInstallRequested();
      return;
    }
    if (isError) {
      window.update?.check?.();
    }
  };

  return (
    <motion.div
      className="relative"
      layout
      initial={{ opacity: 0, scale: 0.96, x: 16 }}
      animate={{ opacity: 1, scale: 1, x: 0 }}
      exit={{ opacity: 0, scale: 0.96, x: 10 }}
      transition={{ type: "spring", stiffness: 520, damping: 32, mass: 0.75 }}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={isChecking || (installRequested && !isReady)}
        aria-label={label}
        className={`no-drag card-floating flex h-7 items-center rounded-lg border border-white/[0.08] px-2.5 text-[10px] font-medium text-white/75 transition-colors duration-200 ${
          isError
            ? "bg-red-300/[0.08] hover:bg-red-300/[0.12]"
            : "bg-white/[0.055] hover:bg-white/[0.085]"
        } ${
          isChecking || (installRequested && !isReady)
            ? "cursor-default opacity-85"
            : "cursor-pointer"
        }`}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <span className="whitespace-nowrap">{label}</span>
      </button>
      <AnimatePresence>
        {installRequested && isAvailable && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="card-floating pointer-events-none absolute bottom-9 right-0 w-36 rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-[10px] text-white/65 shadow-[0_10px_28px_rgba(0,0,0,0.24)]"
          >
            Downloading update…
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// --- Main Component --- //
interface SettingsPanelProps {
  embeddedMode?: boolean; // When true, removes drag region and adjusts layout for pill
  onRequestCollapse?: () => void; // Ask parent to collapse (so system sheets are visible)
  onToggleFloatingBar?: (enabled: boolean) => void;
  onHeightChange?: (height: number) => void;
  initialTab?: SettingsPanelInitialTab; // Initial tab to show (for paste-shortcut → history UX)
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({
  embeddedMode = false,
  onToggleFloatingBar,
  onHeightChange,
  initialTab = "settings",
}) => {
  // State
  const [activeTab, setActiveTab] = useState<SettingsPanelTab>(initialTab);

  // Sync activeTab when initialTab prop changes (e.g., on re-expand with paste timing)
  const prevInitialTabRef = useRef(initialTab);
  useEffect(() => {
    if (prevInitialTabRef.current !== initialTab) {
      setActiveTab(initialTab);
      prevInitialTabRef.current = initialTab;
    }
  }, [initialTab]);

  const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>(
    [DEFAULT_MIC_DEVICE],
  );
  const [selectedMicId, setSelectedMicId] = useState<string>("default");
  const [showFloatingBar, setShowFloatingBar] = useState<boolean | null>(null);
  const [showInDock, setShowInDock] = useState<boolean | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");
  const [updateState, setUpdateState] = useState<UpdatePanelState | null>(null);
  const [showUpdateCapsule, setShowUpdateCapsule] = useState(false);
  const [installRequested, setInstallRequested] = useState(false);

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

  useEffect(() => {
    if (!embeddedMode) {
      setShowUpdateCapsule(false);
      return;
    }
    const timer = setTimeout(() => setShowUpdateCapsule(true), 520);
    return () => clearTimeout(timer);
  }, [embeddedMode]);

  const handleInstallUpdate = () => {
    setInstallRequested(true);
    window.update
      ?.installWhenReady?.()
      .then((result) => {
        if (result?.snapshot) setUpdateState(result.snapshot);
      })
      .catch(() => {
        setInstallRequested(false);
      });
  };

  useEffect(() => {
    let isMounted = true;
    window.update
      ?.getState?.()
      .then((state) => {
        if (isMounted) setUpdateState(state);
      })
      .catch(() => {
        setUpdateState(null);
      });

    const unsubscribe = window.update?.onStateChanged?.((state) => {
      setUpdateState(state);
    });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
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
          return;
        }
        const vis = await window.electron?.isFloatingBarVisible?.();
        if (isMounted) {
          setShowFloatingBar(
            vis && typeof vis.visible === "boolean" ? vis.visible : true,
          );
        }
      } catch {
        // Resolve to a value so the toggle never sticks on the placeholder.
        if (isMounted) setShowFloatingBar(true);
      }
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
        if (isMounted) {
          setShowInDock(
            result && typeof result.visible === "boolean"
              ? result.visible
              : true,
          );
        }
      } catch {
        // Resolve to a value so the toggle never sticks on the placeholder.
        if (isMounted) setShowInDock(true);
      }
    })();

    return () => {
      isMounted = false;
    };
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

        setMicDevices([
          DEFAULT_MIC_DEVICE,
          ...audioInputs.filter((device) => device.id !== DEFAULT_MIC_DEVICE.id),
        ]);
      } catch (err) {
        console.error("[SettingsPanel] Failed to enumerate devices:", err);
        setMicDevices([DEFAULT_MIC_DEVICE]);
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
      {/* Version + update capsule on bottom-right (embedded mode) */}
      {embeddedMode && appVersion && (
        <motion.div
          layout
          className="absolute right-4 bottom-3 z-30 flex items-center gap-2"
        >
          <motion.a
            layout
            href="https://spoke.so/changelog"
            onClick={(e) => {
              e.preventDefault();
              window.electron?.openExternal?.("https://spoke.so/changelog");
            }}
            className="no-drag text-[10px] text-muted-foreground opacity-70 whitespace-nowrap cursor-pointer hover:opacity-95 transition-opacity duration-200"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            Spoke Beta {appVersion}
          </motion.a>
          <AnimatePresence initial={false}>
            {showUpdateCapsule && (
              <UpdateCapsule
                key={`${updateState?.status ?? "idle"}-${updateState?.readyToInstall ? "ready" : "pending"}`}
                updateState={updateState}
                onInstallRequested={handleInstallUpdate}
                installRequested={installRequested}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}

      {/* Draggable Header - only show in standalone mode */}
      {!embeddedMode && (
        <div className="border-b border-border/40 bg-background flex-shrink-0 drag-region">
          <div className="h-6" />
        </div>
      )}

      {/* Content container for height measurement - includes navbar */}
      <motion.div
        ref={contentRef}
        variants={panelCascadeContainer}
        initial="hidden"
        animate="visible"
      >
        {/* Tab Navigation - top bezel */}
        <motion.div
          variants={panelCascadeItem}
          className="bg-background flex-shrink-0 no-drag"
          style={{
            paddingTop: "var(--nav-bar-padding-top)",
            paddingBottom: "6px",
          }}
        >
          <div className="flex items-center justify-center px-6">
            <div className="flex items-center gap-0.5 border border-white/[0.08] rounded-lg p-1">
              <TabButton
                active={activeTab === "settings"}
                iconName="gearshape.fill"
                label="Settings"
                onClick={() => setActiveTab("settings")}
              />
              <TabButton
                active={activeTab === "models"}
                iconName="brain"
                label="Models"
                onClick={() => setActiveTab("models")}
              />
              <TabButton
                active={activeTab === "history"}
                iconName="clock.arrow.trianglehead.counterclockwise.rotate.90"
                label="History"
                onClick={() => setActiveTab("history")}
              />
            </div>
          </div>
        </motion.div>

        {/* Scrollable Content - the screen */}
        <div className="relative flex-1">
          {/* Top fade gradient - dynamic */}
          <div
            className="absolute top-0 left-0 right-0 h-12 pointer-events-none z-20 transition-opacity duration-200"
            style={{
              background:
                "linear-gradient(to bottom, hsl(var(--background)), transparent)",
              opacity: canScrollUp ? 1 : 0,
            }}
          />
          <div
            ref={scrollRef}
            className="overflow-y-auto h-full scrollbar-hide"
            style={{ maxHeight: "530px" }}
            onScroll={updateScrollIndicators}
          >
            <div className="max-w-lg mx-auto w-full px-5 pt-0 pb-14">
              {activeTab === "settings" ? (
                <motion.div
                  key="settings-tab"
                  initial="hidden"
                  animate="visible"
                  variants={panelCascadeContainer}
                  className="flex flex-col"
                >
                  {/* Section 1: Defaults */}
                  <motion.section
                    variants={panelCascadeContainer}
                    className="space-y-4"
                    style={{ marginTop: "var(--panel-section-offset)" }}
                  >
                    <motion.div variants={panelCascadeItem}>
                      <SectionSeparator title="Defaults" />
                    </motion.div>

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
                            console.error(
                              "[Settings] Failed to set dock visibility:",
                              error,
                            );
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
                    </div>
                  </motion.section>
                </motion.div>
              ) : activeTab === "models" ? (
                <motion.div
                  key="models-tab"
                  initial="hidden"
                  animate="visible"
                  variants={panelCascadeContainer}
                  className="flex flex-col"
                >
                  <motion.section
                    variants={panelCascadeContainer}
                    className="space-y-4"
                    style={{ marginTop: "var(--panel-section-offset)" }}
                  >
                    <motion.div variants={panelCascadeItem}>
                      <SectionSeparator title="Transcription" />
                    </motion.div>
                    <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-background no-drag [&>*:last-child]:border-b-0">
                      <ModelInstallCard inGroup />
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
              background:
                "linear-gradient(to bottom, transparent, hsl(var(--background)))",
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
                <p className="text-[10px] text-muted-foreground opacity-70">
                  {appVersion ? `Spoke Beta ${appVersion}` : ""}
                </p>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default React.memo(SettingsPanel);
