import React, {
  lazy,
  Suspense,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { AnimatePresence, m } from "framer-motion";
import { Switch } from "./ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "./ui/select";
import SettingsCard from "./SettingsCard";
import SfIcon from "./icons/SfIcon";
import Spinner from "./ui/Spinner";
import ProgressRing from "./ui/ProgressRing";
import { usePanelAutoHeight } from "../hooks/usePanelAutoHeight";
import { SectionSeparator } from "./SectionSeparator";
import DownloadGlyph from "./DownloadGlyph";
import {
  panelCascadeContainer,
  panelCascadeItem,
} from "./shared/panelMotion";
import {
  DEFAULT_MICROPHONE,
  discoverMicrophoneDevices,
} from "../utils/microphoneDevices";

type SettingsPanelTab = "settings" | "models" | "dictionary" | "history";
type SettingsPanelInitialTab = Extract<
  SettingsPanelTab,
  "settings" | "history"
>;

const ModelsList = lazy(() => import("./ModelsList"));
const DictionaryView = lazy(() => import("./DictionaryView"));
const TranscriptionHistoryView = lazy(() => import("./TranscriptionHistoryView"));

const DEFAULT_MIC_DEVICE = DEFAULT_MICROPHONE;

const TabLoadingFallback: React.FC = () => (
  <div className="flex justify-center py-8 text-[13px] text-primary/50">
    Loading…
  </div>
);

type UpdatePanelState = {
  status:
    | "idle"
    | "checking"
    | "available"
    | "downloading"
    | "not-available"
    | "error";
  version: string | null;
  readyToInstall: boolean;
  error: string | null;
  // 0..100 while downloading, 100 when ready, null otherwise.
  downloadPercent: number | null;
};

function sameUpdatePanelState(
  previous: UpdatePanelState | null,
  next: UpdatePanelState | null,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return previous === next;
  return (
    previous.status === next.status &&
    previous.version === next.version &&
    previous.readyToInstall === next.readyToInstall &&
    previous.error === next.error &&
    previous.downloadPercent === next.downloadPercent
  );
}

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
      <m.div
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
    <m.span
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
    </m.span>
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
  ready: "Restart",
  error: "Try again",
};

// Spoken label — the icon-only rest state needs a name for screen readers and
// for tests to target.
const UPDATE_CAPSULE_ARIA: Record<UpdateCapsuleMode, string> = {
  available: "Download update",
  downloading: "Downloading update",
  checking: "Checking for updates",
  ready: "Restart to update",
  error: "Retry update check",
};

const UPDATE_INTERACTIVE_MODES = new Set<UpdateCapsuleMode>([
  "available",
  "ready",
  "error",
]);

// Draw-on checkmark — the exact path/animation the Models card uses for its
// "ready" state, so the update's completion reads as the same moment.
const InstalledCheck: React.FC = () => (
  <m.svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    className="shrink-0"
    aria-hidden
  >
    <m.path
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.45, ease: [0.25, 0.8, 0.25, 1] }}
      d="M5 13l4 4L19 7"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </m.svg>
);

// The single slot at the trailing edge of the chip cross-fades between the
// download glyph, the working spinner/ring, and the success checkmark, all in
// the same spot, same size, so nothing shifts as the state advances. While
// downloading we know the real percent, so the slot fills a determinate
// ProgressRing (the determinate cousin of Spinner, same monochrome geometry the
// Models card uses); `checking` has no percent yet so it keeps the indeterminate
// spinner, and `downloading` falls back to the spinner if percent is missing.
function updateCapsuleIcon(
  mode: UpdateCapsuleMode,
  downloadPercent: number | null,
): {
  key: string;
  node: React.ReactNode;
} {
  if (mode === "downloading" && downloadPercent != null) {
    return {
      key: "ring",
      node: (
        <ProgressRing
          progress={downloadPercent / 100}
          className="h-3.5 w-3.5"
        />
      ),
    };
  }
  if (mode === "downloading" || mode === "checking") {
    return { key: "spinner", node: <Spinner className="h-3.5 w-3.5" /> };
  }
  if (mode === "ready") {
    return { key: "check", node: <InstalledCheck /> };
  }
  return { key: "download", node: <DownloadGlyph /> };
}

function deriveUpdateCapsuleMode(
  state: UpdatePanelState | null,
): UpdateCapsuleMode | null {
  if (!state) return null;
  if (state.readyToInstall) return "ready";
  // The downloading visual comes straight from the engine's real status, not a
  // renderer-local guess, so it stays correct even if the panel is closed and
  // reopened mid-download.
  if (state.status === "downloading") return "downloading";
  if (state.status === "checking") return "checking";
  if (state.status === "available") return "available";
  if (state.status === "error") return "error";
  return null;
}

const UpdateCapsule: React.FC<{
  mode: UpdateCapsuleMode;
  // Real download progress (0..100) from the engine; drives the determinate
  // ring while `mode` is "downloading". Null in every other mode.
  downloadPercent: number | null;
  // The capsule is mounted (reserving its layout slot) as soon as an update
  // exists, but stays invisible until `revealed` flips after the entrance
  // delay. Reserving the slot up front means the version never reflows when the
  // icon appears — it simply blooms in place.
  revealed: boolean;
  // Hover is tracked on the whole version+capsule row (in the parent), not the
  // button, so the expanded label stays open as the cursor moves left onto the
  // version — the hover target never collapses out from under you.
  hovered: boolean;
  onInstall: () => void;
  onRestart: () => void;
  onRetry: () => void;
}> = ({
  mode,
  downloadPercent,
  revealed,
  hovered,
  onInstall,
  onRestart,
  onRetry,
}) => {
  const interactive = UPDATE_INTERACTIVE_MODES.has(mode);
  // The working states (downloading / checking) collapse to a bare spinner —
  // no label — so clicking the download glyph simply morphs it into a spinner
  // in place while the text slides away. The actionable states rest as their
  // icon and reveal their label on hover (Update available / Restart /
  // Try again) so the chip stays compact until you reach for it.
  const showLabel = interactive && hovered;
  const icon = updateCapsuleIcon(mode, downloadPercent);

  const handleClick = () => {
    if (mode === "ready") onRestart();
    else if (mode === "available") onInstall();
    else if (mode === "error") onRetry();
  };

  return (
    // The whole chip — background, border and icon together — scales up from
    // its center while fading in, as one cohesive motion on a single spring.
    // It reserves its slot while invisible (scale is a transform, so layout is
    // unaffected); nothing slides — the version is handled separately.
    <m.div
      style={{
        transformOrigin: "center center",
        pointerEvents: revealed ? "auto" : "none",
      }}
      initial={{ opacity: 0, scale: 0 }}
      animate={{ opacity: revealed ? 1 : 0, scale: revealed ? 1 : 0 }}
      exit={{ opacity: 0, scale: 0 }}
      transition={UPDATE_CAPSULE_POP}
    >
      <m.button
        type="button"
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
        {/* Hover label for the actionable states; its width animates 0 -> auto
            so it extends the chip leftward while the icon slot stays pinned to
            the right edge. */}
        <m.span
          initial={false}
          animate={{
            width: showLabel ? "auto" : 0,
            opacity: showLabel ? 1 : 0,
            marginRight: showLabel ? 6 : 0,
          }}
          transition={UPDATE_CAPSULE_SPRING}
          className="overflow-hidden whitespace-nowrap"
        >
          {UPDATE_CAPSULE_LABELS[mode]}
        </m.span>

        {/* Trailing icon slot — fixed-size; the chip's scale handles the
            entrance, and this only cross-fades the glyph / spinner / checkmark
            in place as the state advances. Like the Models card, it's a plain
            opacity cross-fade (no scale pop) — but simultaneous, since the slot
            is fixed-size and the icons overlap, so one dissolves into the next
            with no dead gap. The checkmark then draws itself on. */}
        <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center">
          <AnimatePresence initial={false}>
            <m.span
              key={icon.key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="absolute inset-0 flex items-center justify-center"
            >
              {icon.node}
            </m.span>
          </AnimatePresence>
        </span>
      </m.button>
    </m.div>
  );
};

const UpdateCapsuleRow: React.FC<{ appVersion: string }> = React.memo(
  ({ appVersion }) => {
    const [updateState, setUpdateState] = useState<UpdatePanelState | null>(
      null,
    );
    const [showUpdateCapsule, setShowUpdateCapsule] = useState(false);
    const [capsuleHovered, setCapsuleHovered] = useState(false);
    const capsuleHoverTimers = useRef<{
      open: ReturnType<typeof setTimeout> | null;
      close: ReturnType<typeof setTimeout> | null;
    }>({ open: null, close: null });
    const pendingStateRef = useRef<UpdatePanelState | null>(null);
    const scheduledStateFrameRef = useRef<number | null>(null);
    const scheduledWithRafRef = useRef(false);

    const capsuleMode = deriveUpdateCapsuleMode(updateState);

    const handleCapsuleHoverEnter = () => {
      const timers = capsuleHoverTimers.current;
      if (timers.close) clearTimeout(timers.close);
      if (timers.open) clearTimeout(timers.open);
      timers.close = null;
      timers.open = setTimeout(() => setCapsuleHovered(true), 150);
    };

    const handleCapsuleHoverLeave = () => {
      const timers = capsuleHoverTimers.current;
      if (timers.open) clearTimeout(timers.open);
      timers.open = null;
      timers.close = setTimeout(() => setCapsuleHovered(false), 100);
    };

    useEffect(
      () => () => {
        const timers = capsuleHoverTimers.current;
        if (timers.open) clearTimeout(timers.open);
        if (timers.close) clearTimeout(timers.close);
      },
      [],
    );

    useEffect(() => {
      const timer = setTimeout(() => setShowUpdateCapsule(true), 520);
      return () => clearTimeout(timer);
    }, []);

    const commitUpdateState = (next: UpdatePanelState | null) => {
      setUpdateState((previous) =>
        sameUpdatePanelState(previous, next) ? previous : next,
      );
    };

    const handleInstallUpdate = () => {
      window.update
        ?.installWhenReady?.()
        .then((result) => {
          if (result?.snapshot) commitUpdateState(result.snapshot);
        })
        .catch(() => {
          // ignore. The engine keeps broadcasting the authoritative state.
        });
    };

    useEffect(() => {
      let isMounted = true;

      const flushPendingState = () => {
        scheduledStateFrameRef.current = null;
        const pending = pendingStateRef.current;
        pendingStateRef.current = null;
        if (isMounted && pending) commitUpdateState(pending);
      };

      const cancelPendingFrame = () => {
        const scheduled = scheduledStateFrameRef.current;
        if (scheduled === null) return;
        if (scheduledWithRafRef.current) {
          window.cancelAnimationFrame(scheduled);
        } else {
          window.clearTimeout(scheduled);
        }
        scheduledStateFrameRef.current = null;
      };

      const scheduleProgressState = (state: UpdatePanelState) => {
        pendingStateRef.current = state;
        if (scheduledStateFrameRef.current !== null) return;
        if (typeof window.requestAnimationFrame === "function") {
          scheduledWithRafRef.current = true;
          scheduledStateFrameRef.current = window.requestAnimationFrame(
            flushPendingState,
          );
        } else {
          scheduledWithRafRef.current = false;
          scheduledStateFrameRef.current = window.setTimeout(
            flushPendingState,
            0,
          );
        }
      };

      const applyBroadcastState = (state: UpdatePanelState) => {
        // Progress is the only high-frequency update. Keep its latest value
        // for the next paint, but apply phase changes immediately so a
        // completed or failed update cannot wait behind a queued frame.
        if (state.status === "downloading" && !state.readyToInstall) {
          scheduleProgressState(state);
          return;
        }
        pendingStateRef.current = null;
        cancelPendingFrame();
        if (isMounted) commitUpdateState(state);
      };

      window.update
        ?.getState?.()
        .then((state) => {
          if (isMounted) commitUpdateState(state);
        })
        .catch(() => {
          if (isMounted) commitUpdateState(null);
        });

      const unsubscribe = window.update?.onStateChanged?.((state) => {
        applyBroadcastState(state as UpdatePanelState);
      });

      return () => {
        isMounted = false;
        pendingStateRef.current = null;
        cancelPendingFrame();
        unsubscribe?.();
      };
    }, []);

    if (!appVersion) return null;

    return (
      <div
        className="absolute right-4 bottom-3 z-30 flex items-center gap-2"
        onMouseEnter={handleCapsuleHoverEnter}
        onMouseLeave={handleCapsuleHoverLeave}
      >
        {/* Reserve the capsule slot immediately; only the version text shifts
            when the update affordance is visually revealed. */}
        <m.a
          initial={false}
          animate={{ x: capsuleMode && !showUpdateCapsule ? 40 : 0 }}
          transition={{
            x: showUpdateCapsule ? UPDATE_CAPSULE_POP : { duration: 0 },
          }}
          href="https://spoke.so/changelog"
          onClick={(e) => {
            e.preventDefault();
            window.electron?.openExternal?.("https://spoke.so/changelog");
          }}
          className="no-drag text-[10px] text-muted-foreground opacity-70 whitespace-nowrap cursor-pointer hover:opacity-95 transition-opacity duration-200"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          Spoke v{appVersion}
        </m.a>
        <AnimatePresence initial={false}>
          {capsuleMode && (
            <UpdateCapsule
              key="update-capsule"
              mode={capsuleMode}
              downloadPercent={updateState?.downloadPercent ?? null}
              revealed={showUpdateCapsule}
              hovered={capsuleHovered}
              onInstall={handleInstallUpdate}
              onRestart={() => window.update?.restart?.()}
              onRetry={handleInstallUpdate}
            />
          )}
        </AnimatePresence>
      </div>
    );
  },
);

// --- Main Component --- //
interface SettingsPanelProps {
  embeddedMode?: boolean; // When true, removes drag region and adjusts layout for pill
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
  const [autoSpace, setAutoSpace] = useState<boolean | null>(null);
  const [appVersion, setAppVersion] = useState<string>("");

  // Load independent startup settings together so their async results commit
  // in one React update instead of causing a render per bridge response.
  useEffect(() => {
    let isMounted = true;

    const loadInitialSettings = async () => {
      const [version, floatingBar, dock, autoSpaceEnabled] = await Promise.all([
        (async () => {
          try {
            const value = await window.app?.getVersion?.();
            return value && typeof value === "string" ? value : "";
          } catch {
            return "";
          }
        })(),
        (async () => {
          try {
            // Prefer persisted intent if available; fallback to current visibility.
            const pref = await window.electron?.getFloatingBarEnabled?.();
            if (pref && typeof pref.enabled === "boolean") {
              return pref.enabled;
            }
            const vis = await window.electron?.isFloatingBarVisible?.();
            return vis && typeof vis.visible === "boolean" ? vis.visible : true;
          } catch {
            return true;
          }
        })(),
        (async () => {
          try {
            const result = await window.electron?.getDockVisible?.();
            return result && typeof result.visible === "boolean"
              ? result.visible
              : true;
          } catch {
            return true;
          }
        })(),
        (async () => {
          try {
            const result = await window.electron?.getAutoSpaceEnabled?.();
            return result && typeof result.enabled === "boolean"
              ? result.enabled
              : true;
          } catch {
            return true;
          }
        })(),
      ]);

      if (!isMounted) return;
      setAppVersion(version);
      setShowFloatingBar(floatingBar);
      setShowInDock(dock);
      setAutoSpace(autoSpaceEnabled);
    };

    void loadInitialSettings();

    return () => {
      isMounted = false;
    };
  }, []);

  // Listen for microphone device updates and selection changes
  useEffect(() => {
    const updateDeviceList = async () => {
      try {
        const devices = await discoverMicrophoneDevices();
        setMicDevices(devices);
        window.mic?.updateDevices?.(devices);
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
      {embeddedMode && <UpdateCapsuleRow appVersion={appVersion} />}

      {/* Draggable Header - only show in standalone mode */}
      {!embeddedMode && (
        <div className="border-b border-border/40 bg-background flex-shrink-0 drag-region">
          <div className="h-6" />
        </div>
      )}

      {/* Content container for height measurement - includes navbar */}
      <m.div
        ref={contentRef}
        variants={panelCascadeContainer}
        initial="hidden"
        animate="visible"
      >
        {/* Tab Navigation - top bezel */}
        <m.div
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
                active={activeTab === "dictionary"}
                iconName="text.book.closed"
                label="Dictionary"
                onClick={() => setActiveTab("dictionary")}
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
        </m.div>

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
                <m.div
                  key="settings-tab"
                  initial="hidden"
                  animate="visible"
                  variants={panelCascadeContainer}
                  className="flex flex-col"
                >
                  {/* Section 1: Defaults */}
                  <m.section
                    variants={panelCascadeContainer}
                    className="space-y-4"
                    style={{ marginTop: "var(--panel-section-offset)" }}
                  >
                    <m.div variants={panelCascadeItem}>
                      <SectionSeparator title="Defaults" />
                    </m.div>

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

                      <Toggle
                        label="Auto-Space"
                        description="Add a space after each dictation"
                        enabled={autoSpace}
                        onChange={async (enabled) => {
                          setAutoSpace(enabled);
                          try {
                            await window.electron?.setAutoSpaceEnabled?.(
                              enabled,
                            );
                          } catch (error) {
                            console.error(
                              "[Settings] Failed to set auto-space:",
                              error,
                            );
                          }
                        }}
                        icon={
                          <SfIcon
                            name="space"
                            size={16}
                            className="text-primary/70"
                          />
                        }
                        inGroup
                      />
                    </div>
                  </m.section>
                </m.div>
              ) : activeTab === "models" ? (
                <m.div
                  key="models-tab"
                  initial="hidden"
                  animate="visible"
                  variants={panelCascadeContainer}
                  className="flex flex-col"
                >
                  <m.section
                    variants={panelCascadeContainer}
                    className="space-y-4"
                    style={{ marginTop: "var(--panel-section-offset)" }}
                  >
                    <m.div variants={panelCascadeItem}>
                      <SectionSeparator title="Transcription" />
                    </m.div>
                    <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-background no-drag [&>*:last-child]:border-b-0">
                      <Suspense fallback={<TabLoadingFallback />}>
                        <ModelsList enabled={activeTab === "models"} />
                      </Suspense>
                    </div>
                  </m.section>
                </m.div>
              ) : activeTab === "dictionary" ? (
                <Suspense fallback={<TabLoadingFallback />}>
                  <DictionaryView />
                </Suspense>
              ) : (
                <Suspense fallback={<TabLoadingFallback />}>
                  <TranscriptionHistoryView />
                </Suspense>
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
      </m.div>
    </div>
  );
};

export default React.memo(SettingsPanel);
