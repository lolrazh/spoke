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

type UpdateCapsuleMode =
  | "available"
  | "downloading"
  | "checking"
  | "ready"
  | "error";

// Smooth spring for the hover label expansion.
const UPDATE_CAPSULE_SPRING = {
  type: "spring",
  stiffness: 480,
  damping: 30,
  mass: 0.85,
} as const;

// Clean pop for the capsule scaling up in place (and the version easing aside
// to match) — snappy with just a little overshoot, not a wobble.
const UPDATE_CAPSULE_POP = {
  type: "spring",
  stiffness: 600,
  damping: 26,
  mass: 0.7,
} as const;

// Visible text per mode. `available` rests as an icon and only reveals this
// label on hover; the other modes always show it.
const UPDATE_CAPSULE_LABELS: Record<UpdateCapsuleMode, string> = {
  available: "Update available",
  downloading: "Downloading",
  checking: "Checking",
  ready: "Restart Spoke",
  error: "Try again",
};

// Spoken label — the icon-only rest state needs a name for screen readers and
// for tests to target.
const UPDATE_CAPSULE_ARIA: Record<UpdateCapsuleMode, string> = {
  available: "Download update",
  downloading: "Downloading update",
  checking: "Checking for updates",
  ready: "Restart Spoke to update",
  error: "Retry update check",
};

const UPDATE_INTERACTIVE_MODES = new Set<UpdateCapsuleMode>([
  "available",
  "ready",
  "error",
]);

// Download glyph for the resting affordance — hand-rolled to match the stroke
// language of the install checkmark (no SF symbol exists for this).
const DownloadGlyph: React.FC = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0"
    aria-hidden
  >
    <path d="M12 4v10" />
    <path d="M7.5 10.5 12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </svg>
);

// Draw-on checkmark — the exact path/animation the Models card uses for its
// "ready" state, so the update's completion reads as the same moment.
const InstalledCheck: React.FC = () => (
  <motion.svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    className="shrink-0"
    aria-hidden
  >
    <motion.path
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.45, ease: [0.25, 0.8, 0.25, 1] }}
      d="M5 13l4 4L19 7"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </motion.svg>
);

// Honest indeterminate progress — Squirrel.Mac reports no percentage, so a
// looping sweep (borrowing the Models gradient) communicates "working" without
// faking a number.
const IndeterminateSweep: React.FC = () => (
  <span
    className="pointer-events-none absolute inset-x-1.5 bottom-[2px] h-[2px] overflow-hidden rounded-full"
    aria-hidden
  >
    <motion.span
      className="absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-white/20 to-white/70"
      animate={{ x: ["-110%", "230%"] }}
      transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut" }}
    />
  </span>
);

function deriveUpdateCapsuleMode(
  state: UpdatePanelState | null,
  installRequested: boolean,
): UpdateCapsuleMode | null {
  if (!state) return null;
  if (state.readyToInstall) return "ready";
  if (state.status === "checking") return "checking";
  if (state.status === "available") {
    return installRequested ? "downloading" : "available";
  }
  if (state.status === "error") return "error";
  return null;
}

const UpdateCapsule: React.FC<{
  mode: UpdateCapsuleMode;
  onInstall: () => void;
  onRestart: () => void;
  onRetry: () => void;
}> = ({ mode, onInstall, onRestart, onRetry }) => {
  const [hovered, setHovered] = useState(false);
  const interactive = UPDATE_INTERACTIVE_MODES.has(mode);
  const isAvailable = mode === "available";
  const isBusy = mode === "downloading" || mode === "checking";
  // `available` rests as a bare icon and reveals its label on hover; every
  // other mode shows the label so download/ready feedback is visible without
  // hovering.
  const showLabel = isAvailable ? hovered : true;

  const handleClick = () => {
    if (mode === "ready") onRestart();
    else if (mode === "available") onInstall();
    else if (mode === "error") onRetry();
  };

  return (
    // The capsule sizes up in place — a pronounced scale from center (explicit
    // origin so it can never anchor to a corner), never sliding in from a
    // direction. The version eases aside separately (in the parent).
    <motion.div
      style={{ transformOrigin: "center center" }}
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={UPDATE_CAPSULE_POP}
    >
      <motion.button
        type="button"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        whileTap={interactive ? { scale: 0.95 } : undefined}
        onClick={interactive ? handleClick : undefined}
        disabled={!interactive}
        aria-label={UPDATE_CAPSULE_ARIA[mode]}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className={`no-drag relative flex h-6 items-center overflow-hidden rounded-md px-2 text-[11px] font-medium leading-none transition-colors duration-200 ${
          interactive
            ? "onboarding-cta cursor-pointer"
            : "cursor-default border border-white/[0.08] bg-[rgba(10,10,10,0.55)] text-white/55"
        }`}
      >
        {mode === "ready" && (
          <span className="mr-1.5 flex shrink-0">
            <InstalledCheck />
          </span>
        )}

        {/* The label's own width animates 0 -> auto, so it extends the button
            while the trailing icon stays pinned to the right edge. No layout
            projection means the icon never gets dragged or rescaled. */}
        <motion.span
          initial={false}
          animate={{
            width: showLabel ? "auto" : 0,
            opacity: showLabel ? 1 : 0,
            marginRight: showLabel && isAvailable ? 6 : 0,
          }}
          transition={UPDATE_CAPSULE_SPRING}
          className="overflow-hidden whitespace-nowrap"
        >
          {UPDATE_CAPSULE_LABELS[mode]}
        </motion.span>

        {/* Reserved at full size from mount — the capsule pops in place around
            it, so there's no width-reveal that would read as a slide. */}
        {isAvailable && <DownloadGlyph />}

        {isBusy && <IndeterminateSweep />}
      </motion.button>
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

  const capsuleMode = deriveUpdateCapsuleMode(updateState, installRequested);
  const capsulePresent = showUpdateCapsule && Boolean(capsuleMode);

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
        <div className="absolute right-4 bottom-3 z-30 flex items-center gap-2">
          {/* When the capsule appears, the version slides left into its pushed
              slot (starting from where it sat with no capsule) so the push is
              animated while the capsule itself just pops in place. Keyed so the
              one-shot slide only fires on the present/absent transition; hover
              expansion afterwards moves it via plain reflow. */}
          <motion.a
            key={capsulePresent ? "version-pushed" : "version-rest"}
            initial={{ x: capsulePresent ? 34 : 0 }}
            animate={{ x: 0 }}
            transition={UPDATE_CAPSULE_POP}
            href="https://spoke.so/changelog"
            onClick={(e) => {
              e.preventDefault();
              window.electron?.openExternal?.("https://spoke.so/changelog");
            }}
            className="no-drag text-[10px] text-muted-foreground opacity-70 whitespace-nowrap cursor-pointer hover:opacity-95 transition-opacity duration-200"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            Spoke v{appVersion}
          </motion.a>
          <AnimatePresence initial={false}>
            {showUpdateCapsule && capsuleMode && (
              <UpdateCapsule
                key="update-capsule"
                mode={capsuleMode}
                onInstall={handleInstallUpdate}
                onRestart={() => window.update?.restart?.()}
                onRetry={() => window.update?.check?.()}
              />
            )}
          </AnimatePresence>
        </div>
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
                  {appVersion ? `Spoke v${appVersion}` : ""}
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
