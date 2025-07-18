import React, { useState, useEffect, useMemo } from "react";
import { motion, Variants } from "framer-motion";
import { Switch } from "./ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Button } from "./ui/button";

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
    transition: { type: "spring", stiffness: 400, damping: 30 },
  },
};

// --- Clean Sonic Flow Components --- //
const Toggle: React.FC<{
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
}> = ({ enabled, onChange, label, description }) => (
  <div className="flex items-center justify-between py-3">
    <div className="flex-1">
      <div className="text-xs font-medium text-white">{label}</div>
      {description && (
        <div className="text-[10px] text-gray-300 mt-0.5">{description}</div>
      )}
    </div>
    <Switch checked={enabled} onCheckedChange={onChange} />
  </div>
);

const SelectField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  description?: string;
}> = ({ value, onChange, options, label, description }) => (
  <div className="flex items-center justify-between py-3">
    <div className="flex-1">
      <div className="text-xs font-medium text-white">{label}</div>
      {description && (
        <div className="text-[10px] text-gray-300 mt-0.5">{description}</div>
      )}
    </div>
    <div className="ml-4">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-44">
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
  </div>
);

const ActionButton: React.FC<{
  onClick: () => void;
  label: string;
  description?: string;
  variant?: "default" | "secondary" | "destructive";
}> = ({ onClick, label, description, variant = "secondary" }) => {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1">
        <div className="text-xs font-medium text-white">{label}</div>
        {description && (
          <div className="text-[10px] text-gray-300 mt-0.5">{description}</div>
        )}
      </div>
      <Button variant={variant} size="sm" onClick={onClick} className="ml-4">
        {label}
      </Button>
    </div>
  );
};

const SettingSeparator: React.FC = () => (
  <div className="border-b border-sonic-gray/20" />
);

const SectionSeparator: React.FC<{ title: string }> = ({ title }) => (
  <div className="relative my-6">
    <div className="border-b-2 border-sonic-gray/40" />
    <div className="absolute inset-0 flex items-center justify-center">
      <span className="bg-sonic-darker px-3 text-[10px] font-medium text-gray-300 tracking-wider uppercase">
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
  const [selectedLanguage, setSelectedLanguage] = useState<string>("en-US");
  const [showFloatingBar, setShowFloatingBar] = useState<boolean>(true);
  const [playSounds, setPlaySounds] = useState<boolean>(true);
  const [openAtLogin, setOpenAtLogin] = useState<boolean>(false);

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

  const languageOptions = useMemo(
    () => [
      { value: "en-US", label: "English (US)" },
      { value: "en-GB", label: "English (UK)" },
      { value: "es-ES", label: "Spanish" },
      { value: "fr-FR", label: "French" },
      { value: "de-DE", label: "German" },
      { value: "it-IT", label: "Italian" },
      { value: "pt-BR", label: "Portuguese (Brazil)" },
    ],
    [],
  );

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

  const handleOpenKeybindingModal = (type: "dictation" | "instruction") => {
    // TODO: Implement modal for keybinding configuration
    console.log(`Opening ${type} keybinding modal`);
  };

  const handleSignOut = () => {
    // TODO: Implement sign out functionality
    console.log("Signing out");
  };

  return (
    <div
      className={`${embeddedMode ? "h-full" : "h-screen"} bg-sonic-darker text-white flex flex-col relative`}
    >
      {/* Vertical version text on bottom-left - only in embedded mode */}
      {embeddedMode && (
        <div className="absolute left-5 bottom-4 transform -rotate-90 origin-bottom-left text-[10px] text-gray-300/50 whitespace-nowrap">
          v0.0.1
        </div>
      )}

      {/* Draggable Header - only show in standalone mode */}
      {!embeddedMode && (
        <div
          className="border-b border-sonic-gray/40 bg-sonic-dark flex-shrink-0"
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
            className="space-y-0"
          >
            {/* Section 1: Defaults */}
            <motion.div variants={sectionVariants}>
              <SectionSeparator title="Defaults" />

              <SelectField
                label="Microphone"
                description="Select your preferred input device"
                value={selectedMicId}
                onChange={handleMicChange}
                options={micOptions}
              />
              <SettingSeparator />

              <SelectField
                label="Language"
                description="Recognition language for transcription"
                value={selectedLanguage}
                onChange={setSelectedLanguage}
                options={languageOptions}
              />
              <SettingSeparator />

              <ActionButton
                label="Keybind"
                description="Set custom hotkey for voice dictation"
                onClick={() => handleOpenKeybindingModal("dictation")}
              />
            </motion.div>

            {/* Section 2: System */}
            <motion.div variants={sectionVariants}>
              <SectionSeparator title="System" />

              <Toggle
                label="Show Floating Bar"
                description="Display the floating dictation pill"
                enabled={showFloatingBar}
                onChange={setShowFloatingBar}
              />
              <SettingSeparator />

              <Toggle
                label="Play Sounds"
                description="Audio feedback for dictation start/stop"
                enabled={playSounds}
                onChange={setPlaySounds}
              />
              <SettingSeparator />

              <Toggle
                label="Open at Login"
                description="Automatically start Sonic Flow when you log in"
                enabled={openAtLogin}
                onChange={setOpenAtLogin}
              />
            </motion.div>

            {/* Section 3: Account */}
            <motion.div variants={sectionVariants}>
              <SectionSeparator title="Account" />

              <div className="flex items-center justify-between py-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gradient-to-t from-sonic-primary to-sonic-light rounded-full flex items-center justify-center text-xs font-bold text-white">
                    JS
                  </div>
                  <div>
                    <h3 className="text-xs font-medium text-white">
                      John Smith
                    </h3>
                    <p className="text-[10px] text-gray-300">
                      john.smith@example.com
                    </p>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={handleSignOut}>
                  Sign Out
                </Button>
              </div>
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
                <p className="text-[10px] text-gray-300/70">v0.0.1</p>
              </motion.footer>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(HomePage);
