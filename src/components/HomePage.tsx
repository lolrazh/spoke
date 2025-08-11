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
}> = ({ enabled, onChange, label, description }) => (
  <SettingsCard
    title={label}
    description={description}
    icon={
      <svg className="w-4 h-4 text-primary/70" viewBox="0 0 20 20" fill="currentColor">
        <path d="M11.983 1.284a2 2 0 00-3.966 0l-.09.542a2 2 0 01-1.274 1.556l-.5.19a2 2 0 00-1.05 2.796l.257.498a2 2 0 010 1.768l-.257.498a2 2 0 001.05 2.796l.5.19a2 2 0 011.274 1.556l.09.542a2 2 0 003.966 0l.09-.542a2 2 0 011.274-1.556l.5-.19a2 2 0 001.05-2.796l-.257-.498a2 2 0 010-1.768l.257-.498a2 2 0 00-1.05-2.796l-.5-.19a2 2 0 01-1.274-1.556l-.09-.542z" />
      </svg>
    }
  >
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
    icon={
      <svg className="w-4 h-4 text-primary/70" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 3a7 7 0 100 14A7 7 0 0010 3zM9 7a1 1 0 112 0v3a1 1 0 11-2 0V7zm1 6a1 1 0 100 2 1 1 0 000-2z" clipRule="evenodd" />
      </svg>
    }
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
interface HomePageProps {
  embeddedMode?: boolean; // When true, removes drag region and adjusts layout for pill
}

const HomePage: React.FC<HomePageProps> = ({ embeddedMode = false }) => {
  // State
  const [micDevices, setMicDevices] = useState<{ id: string; label: string }[]>(
    [],
  );
  const [selectedMicId, setSelectedMicId] = useState<string>("default");
  const [showFloatingBar, setShowFloatingBar] = useState<boolean>(true);
  const [playSounds, setPlaySounds] = useState<boolean>(true);

  // Permissions state (mirrors onboarding)
  const [permissions, setPermissions] = useState({
    microphone: false,
    inputMonitoring: false,
    accessibility: false,
  });
  const [ui, setUi] = useState({
    microphone: { loading: false, justGranted: false },
    inputMonitoring: { loading: false, justGranted: false },
    accessibility: { loading: false, justGranted: false },
  });
  const pollRefs = useRef<{ mic?: NodeJS.Timeout | null; im?: NodeJS.Timeout | null; ax?: NodeJS.Timeout | null }>({});
  const axDeepLinkOpenedRef = useRef(false);

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
        console.error("[HomePage] Failed to enumerate devices:", err);
        setMicDevices([]);
      }
    };

    updateDeviceList();
    navigator.mediaDevices.addEventListener("devicechange", updateDeviceList);

    let unsubscribe: (() => void) | undefined;
    if (window.mic?.onSelectedChanged) {
      unsubscribe = window.mic.onSelectedChanged(({ id }) => {
        setSelectedMicId(id);
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

  // Initial permission check
  useEffect(() => {
    const initPerms = async () => {
      try {
        const [sys, mic] = await Promise.all([
          window.electron?.checkPermissions?.(),
          window.electron?.checkMicrophonePermission?.(),
        ]);
        setPermissions({
          microphone: !!mic?.granted,
          inputMonitoring: !(sys?.needIM ?? true),
          accessibility: !(sys?.needAX ?? true),
        });
      } catch (e) {
        // ignore
      }
    };
    initPerms();
    return () => {
      // Cleanup polls if any were started
      if (pollRefs.current.mic) clearInterval(pollRefs.current.mic!);
      if (pollRefs.current.im) clearInterval(pollRefs.current.im!);
      if (pollRefs.current.ax) clearInterval(pollRefs.current.ax!);
      pollRefs.current = { mic: null, im: null, ax: null };
    };
  }, []);

  // Permission handlers
  const handleRequestMicrophone = async () => {
    try {
      setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, loading: true } }));
      const result = await window.electron?.requestMicrophonePermission();
      if (result?.success && result?.granted) {
        setPermissions((p) => ({ ...p, microphone: true }));
        setUi((prev) => ({ ...prev, microphone: { loading: false, justGranted: true } }));
        setTimeout(() => setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, justGranted: false } })), 800);
      } else {
        // Open System Settings and poll
        await window.electron?.openSystemPreferences("microphone");
        if (pollRefs.current.mic) clearInterval(pollRefs.current.mic!);
        pollRefs.current.mic = setInterval(async () => {
          const status = await window.electron?.checkMicrophonePermission();
          if (status?.granted) {
            if (pollRefs.current.mic) {
              clearInterval(pollRefs.current.mic!);
              pollRefs.current.mic = null;
            }
            setPermissions((p) => ({ ...p, microphone: true }));
            setUi((prev) => ({ ...prev, microphone: { loading: false, justGranted: true } }));
            setTimeout(() => setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, justGranted: false } })), 800);
          }
        }, 1000);
        setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, loading: false } }));
      }
    } catch (e) {
      setUi((prev) => ({ ...prev, microphone: { ...prev.microphone, loading: false } }));
    }
  };

  const handleRequestAccessibility = async () => {
    try {
      setUi((prev) => ({ ...prev, accessibility: { ...prev.accessibility, loading: true } }));
      await window.electron?.requestAccessibilityPermission();
      // Poll until granted; deep-link once after grace period
      const startedAt = Date.now();
      if (pollRefs.current.ax) clearInterval(pollRefs.current.ax!);
      pollRefs.current.ax = setInterval(async () => {
        const sys = await window.electron?.checkPermissions?.();
        if (sys && !sys.needAX) {
          if (pollRefs.current.ax) {
            clearInterval(pollRefs.current.ax!);
            pollRefs.current.ax = null;
          }
          setPermissions((p) => ({ ...p, accessibility: true }));
          setUi((prev) => ({ ...prev, accessibility: { loading: false, justGranted: true } }));
          setTimeout(() => setUi((prev) => ({ ...prev, accessibility: { ...prev.accessibility, justGranted: false } })), 800);
        } else if (!axDeepLinkOpenedRef.current && Date.now() - startedAt > 4000) {
          // open the pane once as fallback
          axDeepLinkOpenedRef.current = true;
          await window.electron?.openSystemPreferences("accessibility");
        }
      }, 1000);
      setUi((prev) => ({ ...prev, accessibility: { ...prev.accessibility, loading: false } }));
    } catch (e) {
      setUi((prev) => ({ ...prev, accessibility: { ...prev.accessibility, loading: false } }));
    }
  };

  const handleRequestInputMonitoring = async () => {
    try {
      setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, loading: true } }));
      const result = await window.electron?.askIM();
      if (result?.success && result.status === "authorized") {
        setPermissions((p) => ({ ...p, inputMonitoring: true }));
        setUi((prev) => ({ ...prev, inputMonitoring: { loading: false, justGranted: true } }));
        setTimeout(() => setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, justGranted: false } })), 800);
        return;
      }
      // Open System Settings and poll until granted
      await window.electron?.openSystemPreferences("input-monitoring");
      if (pollRefs.current.im) clearInterval(pollRefs.current.im!);
      pollRefs.current.im = setInterval(async () => {
        const sys = await window.electron?.checkPermissions?.();
        if (sys && !sys.needIM) {
          if (pollRefs.current.im) {
            clearInterval(pollRefs.current.im!);
            pollRefs.current.im = null;
          }
          setPermissions((p) => ({ ...p, inputMonitoring: true }));
          setUi((prev) => ({ ...prev, inputMonitoring: { loading: false, justGranted: true } }));
          setTimeout(() => setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, justGranted: false } })), 800);
        }
      }, 1000);
      setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, loading: false } }));
    } catch (e) {
      setUi((prev) => ({ ...prev, inputMonitoring: { ...prev.inputMonitoring, loading: false } }));
    }
  };

  // Keybind setting removed

  const handleSignOut = () => {
    // TODO: Implement sign out functionality
    console.log("Signing out");
  };

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
        <div
          className="border-b border-border/40 bg-background flex-shrink-0"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
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

              <div className="space-y-3">
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
                  onChange={setShowFloatingBar}
                />

                <Toggle
                  label="Play Sounds"
                  description="Audio feedback for dictation start/stop"
                  enabled={playSounds}
                  onChange={setPlaySounds}
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
                    <svg className="w-4 h-4 text-primary/70" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                    </svg>
                  }
                >
                  {!permissions.microphone ? (
                    <Button size="sm" onClick={handleRequestMicrophone} disabled={ui.microphone.loading} className="text-xs onboarding-cta">
                      <div className="relative flex items-center justify-center h-4 w-14">
                        {ui.microphone.loading ? (
                          <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                          <span>Enable</span>
                        )}
                      </div>
                    </Button>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" className="text-white/80">
                      <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </SettingsCard>

                {/* Accessibility Permission */}
                <SettingsCard
                  title="Accessibility"
                  description="Insert recognized text into your apps"
                  icon={
                    <svg className="w-4 h-4 text-primary/70" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                  }
                >
                  {!permissions.accessibility ? (
                    <Button size="sm" onClick={handleRequestAccessibility} disabled={ui.accessibility.loading} className="text-xs onboarding-cta">
                      <div className="relative flex items-center justify-center h-4 w-14">
                        {ui.accessibility.loading ? (
                          <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                          <span>Enable</span>
                        )}
                      </div>
                    </Button>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" className="text-white/80">
                      <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </SettingsCard>

                {/* Input Monitoring Permission */}
                <SettingsCard
                  title="Input Monitoring"
                  description="Detect the Fn key to start and stop dictation"
                  icon={
                    <svg className="w-4 h-4 text-primary/70" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                    </svg>
                  }
                >
                  {!permissions.inputMonitoring ? (
                    <Button size="sm" onClick={handleRequestInputMonitoring} disabled={ui.inputMonitoring.loading} className="text-xs onboarding-cta">
                      <div className="relative flex items-center justify-center h-4 w-14">
                        {ui.inputMonitoring.loading ? (
                          <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                          <span>Enable</span>
                        )}
                      </div>
                    </Button>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" className="text-white/80">
                      <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </SettingsCard>
              </div>
            </motion.div>

            {/* Section 3: Account */}
            <motion.div variants={sectionVariants}>
              <SectionSeparator title="Account" />

              <SettingsCard
                title="John Smith"
                description="john.smith@example.com"
                icon={
                  <div className="w-5 h-5 rounded-full bg-gradient-to-t from-primary to-foreground/80 flex items-center justify-center text-[10px] font-bold text-white">
                    JS
                  </div>
                }
              >
                <Button variant="secondary" size="sm" onClick={handleSignOut}>Sign Out</Button>
              </SettingsCard>
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
                <p className="text-[10px] text-muted-foreground opacity-70">v0.0.1</p>
              </motion.footer>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(HomePage);
