import React, { useState, useEffect, useMemo, useRef } from "react";
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
import ModelInstallCard from "./ModelInstallCard";
import SfIcon from "./icons/SfIcon";
import { usePanelAutoHeight } from "../hooks/usePanelAutoHeight";
import TranscriptionHistoryView from "./TranscriptionHistoryView";
import { isApiKeyTranscriptionProviderId } from "../core/transcription/providerCatalog";
import {
  LOCAL_STT_PROVIDER_ID,
  type PreferredTranscriptionProviderId,
} from "../core/transcription/providerPreferences";
import { useProviderSelection } from "../hooks/useProviderSelection";

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

type SettingsPanelTab = "settings" | "models" | "history";
type SettingsPanelInitialTab = Extract<
  SettingsPanelTab,
  "settings" | "history"
>;

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
  <SettingsCard
    title={label}
    description={description}
    icon={icon}
    inGroup={inGroup}
  >
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
  icon?: React.ReactNode;
}> = ({ value, onChange, options, label, description, inGroup, icon }) => (
  <SettingsCard
    title={label}
    description={description}
    icon={
      icon ?? (
        <SfIcon name="microphone.fill" size={16} className="text-primary/70" />
      )
    }
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

const ApiKeyField: React.FC<{
  label: string;
  description?: string;
  fieldId: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onClear: () => void;
  configured: boolean;
  saving: boolean;
  placeholder?: string;
  inGroup?: boolean;
  icon?: React.ReactNode;
}> = ({
  label,
  description,
  fieldId,
  value,
  onChange,
  onSave,
  onClear,
  configured,
  saving,
  placeholder,
  inGroup,
  icon,
}) => (
  <SettingsCard
    title={label}
    description={description}
    icon={icon}
    inGroup={inGroup}
  >
    <div className="ml-2 flex items-center gap-2">
      <input
        id={fieldId}
        name={fieldId}
        aria-label={`${label} API key`}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className="card-floating h-9 w-36 rounded-lg border border-white/10 bg-transparent px-3 text-xs text-white/80 placeholder-white/35 outline-none transition-colors focus:border-white/20 focus:bg-white/5 focus-visible:ring-2 focus-visible:ring-white/10"
        style={{ WebkitAppRegion: "no-drag" }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={saving || value.trim().length === 0}
        onClick={onSave}
      >
        {saving ? "Saving…" : "Save Key"}
      </Button>
      {configured && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={saving}
          onClick={onClear}
        >
          Clear
        </Button>
      )}
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
    [],
  );
  const [selectedMicId, setSelectedMicId] = useState<string>("default");
  const [showFloatingBar, setShowFloatingBar] = useState<boolean>(true);
  const [showInDock, setShowInDock] = useState<boolean>(true);
  const {
    setProviderSettings,
    loadProviderSettings,
    providerEntries,
    selectableProviderEntries,
    selectedProviderId,
  } = useProviderSelection();
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [savingProviderKeyId, setSavingProviderKeyId] = useState<string | null>(
    null,
  );
  const [appVersion, setAppVersion] = useState<string>("");

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

  const transcriptionProviderOptions = useMemo(
    () =>
      selectableProviderEntries.length > 0
        ? selectableProviderEntries.map((p) => ({
            value: p.id,
            label: p.displayName,
          }))
        : [{ value: LOCAL_STT_PROVIDER_ID, label: "Local" }],
    [selectableProviderEntries],
  );

  const apiKeyProviders = providerEntries.filter((p) => p.requiresApiKey);

  const handleMicChange = (deviceId: string) => {
    setSelectedMicId(deviceId);
    if (window.mic?.select) {
      window.mic.select(deviceId);
    }
  };

  const handleProviderChange = async (providerId: string) => {
    try {
      await window.stt?.setPreferredProvider?.(
        providerId as PreferredTranscriptionProviderId,
      );
      setProviderSettings(await loadProviderSettings());
    } catch (error) {
      console.error(
        "[Settings] Failed to switch transcription provider:",
        error,
      );
      window.notifications?.send?.("Failed to switch transcription provider.");
    }
  };

  const handleSaveApiKey = async (providerId: string, displayName: string) => {
    if (!isApiKeyTranscriptionProviderId(providerId)) {
      return;
    }
    const apiKey = (apiKeyDrafts[providerId] ?? "").trim();
    if (!apiKey) {
      return;
    }

    setSavingProviderKeyId(providerId);
    try {
      const snapshot = await window.stt?.setProviderApiKey?.(
        providerId,
        apiKey,
      );
      if (snapshot) {
        setProviderSettings(snapshot);
      } else {
        setProviderSettings(await loadProviderSettings());
      }
      setApiKeyDrafts((prev) => ({ ...prev, [providerId]: "" }));
      window.notifications?.send?.(`Saved ${displayName} API key locally.`);
    } catch (error) {
      console.error(`[Settings] Failed to save ${displayName} API key:`, error);
      window.notifications?.send?.(`Failed to save ${displayName} API key.`);
    } finally {
      setSavingProviderKeyId(null);
    }
  };

  const handleClearApiKey = async (providerId: string, displayName: string) => {
    if (!isApiKeyTranscriptionProviderId(providerId)) {
      return;
    }
    setSavingProviderKeyId(providerId);
    try {
      const snapshot = await window.stt?.clearProviderApiKey?.(providerId);
      if (snapshot) {
        setProviderSettings(snapshot);
      } else {
        setProviderSettings(await loadProviderSettings());
      }
      setApiKeyDrafts((prev) => ({ ...prev, [providerId]: "" }));
      window.notifications?.send?.(`Cleared stored ${displayName} API key.`);
    } catch (error) {
      console.error(
        `[Settings] Failed to clear ${displayName} API key:`,
        error,
      );
      window.notifications?.send?.(`Failed to clear ${displayName} API key.`);
    } finally {
      setSavingProviderKeyId(null);
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
        <div
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
                iconName="point.3.filled.connected.trianglepath.dotted"
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
        </div>

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
                  initial="hidden"
                  animate="visible"
                  variants={containerVariants}
                  className="flex flex-col"
                >
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
                  initial="hidden"
                  animate="visible"
                  variants={containerVariants}
                  className="flex flex-col"
                >
                  <motion.section
                    variants={sectionVariants}
                    className="space-y-4"
                    style={{ marginTop: "var(--panel-section-offset)" }}
                  >
                    <SectionSeparator title="Default Model" />

                    <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-background no-drag [&>*:last-child]:border-b-0">
                      <SelectField
                        label="Transcription Provider"
                        description="Choose local or cloud transcription."
                        value={selectedProviderId}
                        onChange={handleProviderChange}
                        options={transcriptionProviderOptions}
                        icon={
                          <SfIcon
                            name="point.3.filled.connected.trianglepath.dotted"
                            size={16}
                            className="text-primary/70"
                          />
                        }
                        inGroup
                      />
                    </div>
                  </motion.section>

                  <motion.section
                    variants={sectionVariants}
                    className="space-y-4"
                    style={{ marginTop: "var(--panel-section-offset)" }}
                  >
                    <SectionSeparator title="Local Model" />
                    <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-background no-drag [&>*:last-child]:border-b-0">
                      <ModelInstallCard inGroup />
                    </div>
                  </motion.section>

                  <motion.section
                    variants={sectionVariants}
                    className="space-y-4"
                    style={{ marginTop: "var(--panel-section-offset)" }}
                  >
                    <SectionSeparator title="Cloud Providers" />

                    <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-background no-drag [&>*:last-child]:border-b-0">
                      {apiKeyProviders.map((provider) => (
                        <ApiKeyField
                          key={provider.id}
                          label={provider.displayName}
                          description={
                            provider.apiKeyConfigured
                              ? "API key saved locally."
                              : "Add an API key to enable this provider."
                          }
                          fieldId={`${provider.id}-api-key`}
                          value={apiKeyDrafts[provider.id] ?? ""}
                          onChange={(v) =>
                            setApiKeyDrafts((prev) => ({
                              ...prev,
                              [provider.id]: v,
                            }))
                          }
                          onSave={() =>
                            handleSaveApiKey(provider.id, provider.displayName)
                          }
                          onClear={() =>
                            handleClearApiKey(provider.id, provider.displayName)
                          }
                          configured={provider.apiKeyConfigured}
                          saving={savingProviderKeyId === provider.id}
                          placeholder={provider.apiKeyPlaceholder ?? ""}
                          icon={
                            <SfIcon
                              name="speaker.wave.3.fill"
                              size={16}
                              className="text-primary/70"
                            />
                          }
                          inGroup
                        />
                      ))}
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
      </div>
    </div>
  );
};

export default React.memo(SettingsPanel);
