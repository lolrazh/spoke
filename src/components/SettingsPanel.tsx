import React, {
  Suspense,
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { m } from "framer-motion";
import { Switch } from "./ui/switch";
import { CompactSelect } from "./ui/compact-select";
import {
  getMicSnapshot,
  getSettingsSnapshot,
  loadSettingsSnapshot,
} from "../state/panelPrefetch";
import SettingsCard from "./SettingsCard";
import SfIcon from "./icons/SfIcon";
import { usePanelAutoHeight } from "../hooks/usePanelAutoHeight";
import { SectionSeparator } from "./SectionSeparator";
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

import {
  DictionaryViewChunk as DictionaryView,
  ModelsListChunk as ModelsList,
  TranscriptionHistoryViewChunk as TranscriptionHistoryView,
} from "./panelChunks";

const DEFAULT_MIC_DEVICE = DEFAULT_MICROPHONE;

const TabLoadingFallback: React.FC = () => (
  <div className="flex justify-center py-8 text-[13px] text-primary/50">
    Loading…
  </div>
);

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
      <CompactSelect
        aria-label={label}
        value={value}
        onValueChange={onChange}
        options={options}
        className="ml-2 w-44"
      />
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

// The version label in the panel corner. Update status lives in the menu-bar
// icon and tray menu, so this is just a link to the changelog.
const VersionLink: React.FC<{ appVersion: string }> = ({ appVersion }) => {
  if (!appVersion) return null;
  return (
    <div className="absolute right-4 bottom-3 z-30 flex items-center gap-2">
      <a
        href="https://spoke.so/changelog"
        onClick={(e) => {
          e.preventDefault();
          window.electron?.openExternal?.("https://spoke.so/changelog");
        }}
        className="no-drag text-[10px] text-muted-foreground opacity-70 whitespace-nowrap cursor-pointer hover:opacity-95 transition-opacity duration-200"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        Spoke v{appVersion}
      </a>
    </div>
  );
};

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

  const settingsSnapshot = getSettingsSnapshot();
  const micSnapshot = getMicSnapshot();
  const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>(
    () => micSnapshot?.devices ?? [DEFAULT_MIC_DEVICE],
  );
  const [selectedMicId, setSelectedMicId] = useState<string>(
    () => micSnapshot?.selectedId ?? "default",
  );
  const [showFloatingBar, setShowFloatingBar] = useState<boolean | null>(
    () => settingsSnapshot?.showFloatingBar ?? null,
  );
  const [showInDock, setShowInDock] = useState<boolean | null>(
    () => settingsSnapshot?.showInDock ?? null,
  );
  const [autoSpace, setAutoSpace] = useState<boolean | null>(
    () => settingsSnapshot?.autoSpace ?? null,
  );
  const [appVersion, setAppVersion] = useState<string>(
    () => settingsSnapshot?.appVersion ?? "",
  );

  // The idle prefetch normally filled the snapshot already, so the first
  // frame is correct; this refresh only catches changes made since then and
  // commits them in one update.
  useEffect(() => {
    let isMounted = true;
    void loadSettingsSnapshot().then((snapshot) => {
      if (!isMounted) return;
      setAppVersion(snapshot.appVersion);
      setShowFloatingBar(snapshot.showFloatingBar);
      setShowInDock(snapshot.showInDock);
      setAutoSpace(snapshot.autoSpace);
    });
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
      {embeddedMode && <VersionLink appVersion={appVersion} />}

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
