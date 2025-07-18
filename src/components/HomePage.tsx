import React, { useState, useEffect, useMemo } from "react";
import { motion, Variants } from "framer-motion";

// --- Animation Variants --- //
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const sectionVariants: Variants = {
  hidden: { y: 10, opacity: 0 },
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
      <div className="text-sm font-medium text-white">{label}</div>
      {description && (
        <div className="text-xs text-gray-400 mt-0.5">{description}</div>
      )}
    </div>
    <motion.button
      className={`relative w-10 h-5 rounded-full transition-colors ${
        enabled ? "bg-sonic-orange" : "bg-sonic-gray/60"
      }`}
      onClick={() => onChange(!enabled)}
      whileTap={{ scale: 0.95 }}
    >
      <motion.div
        className="absolute top-0.5 w-4 h-4 bg-white rounded-full"
        animate={{ x: enabled ? 20 : 2 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </motion.button>
  </div>
);

const Select: React.FC<{
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label: string;
  description?: string;
}> = ({ value, onChange, options, label, description }) => (
  <div className="flex items-center justify-between py-3">
    <div className="flex-1">
      <div className="text-sm font-medium text-white">{label}</div>
      {description && (
        <div className="text-xs text-gray-400 mt-0.5">{description}</div>
      )}
    </div>
    <div className="relative ml-4">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-48 bg-sonic-darker border border-sonic-gray/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-sonic-orange transition-colors appearance-none cursor-pointer"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-sonic-darker">
            {option.label}
          </option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </div>
  </div>
);

const ActionButton: React.FC<{
  onClick: () => void;
  label: string;
  description?: string;
  variant?: "primary" | "secondary" | "danger";
}> = ({ onClick, label, description, variant = "secondary" }) => {
  const getVariantClasses = () => {
    switch (variant) {
      case "primary":
        return "bg-sonic-orange text-white hover:bg-sonic-light-orange";
      case "danger":
        return "bg-red-600 text-white hover:bg-red-700";
      default:
        return "bg-sonic-gray/60 text-white hover:bg-sonic-gray/80";
    }
  };

  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1">
        <div className="text-sm font-medium text-white">{label}</div>
        {description && (
          <div className="text-xs text-gray-400 mt-0.5">{description}</div>
        )}
      </div>
      <motion.button
        onClick={onClick}
        className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ml-4 ${getVariantClasses()}`}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {label}
      </motion.button>
    </div>
  );
};

const SectionCard: React.FC<{ 
  children: React.ReactNode;
  title: string;
}> = ({ children, title }) => (
  <motion.section variants={sectionVariants}>
    <div className="mb-3">
      <h2 className="text-lg font-medium text-white">{title}</h2>
    </div>
    
    <div className="bg-sonic-dark rounded-lg border border-sonic-gray/40">
      {children}
    </div>
  </motion.section>
);

const Separator: React.FC = () => (
  <div className="border-b border-sonic-gray/30" />
);

// --- Main Component --- //
const HomePage: React.FC = () => {
  // State
  const [micDevices, setMicDevices] = useState<{id: string, label: string}[]>([]);
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
          .filter(device => device.kind === 'audioinput')
          .map(device => ({
            id: device.deviceId,
            label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`
          }));
        
        const fullList = [
          { id: "default", label: "System Default" },
          ...audioInputs
        ];
        
        setMicDevices(fullList);
      } catch (err) {
        console.error("[HomePage] Failed to enumerate devices:", err);
        setMicDevices([{ id: "default", label: "System Default" }]);
      }
    };

    updateDeviceList();
    navigator.mediaDevices.addEventListener('devicechange', updateDeviceList);

    let unsubscribe: (() => void) | undefined;
    if (window.mic?.onSelectedChanged) {
      unsubscribe = window.mic.onSelectedChanged(({ id }) => {
        setSelectedMicId(id);
      });
    }

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', updateDeviceList);
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const languageOptions = useMemo(() => [
    { value: "en-US", label: "English (US)" },
    { value: "en-GB", label: "English (UK)" },
    { value: "es-ES", label: "Spanish" },
    { value: "fr-FR", label: "French" },
    { value: "de-DE", label: "German" },
    { value: "it-IT", label: "Italian" },
    { value: "pt-BR", label: "Portuguese (Brazil)" },
  ], []);

  const micOptions = useMemo(() => 
    micDevices.map(device => ({
      value: device.id,
      label: device.label,
    })), [micDevices]
  );

  const handleMicChange = (deviceId: string) => {
    setSelectedMicId(deviceId);
    if (window.mic?.select) {
      window.mic.select(deviceId);
    }
  };

  const handleOpenKeybindingModal = (type: 'dictation' | 'instruction') => {
    // TODO: Implement modal for keybinding configuration
    console.log(`Opening ${type} keybinding modal`);
  };

  const handleSignOut = () => {
    // TODO: Implement sign out functionality
    console.log("Signing out");
  };

  return (
    <div className="h-screen bg-sonic-darker text-white flex flex-col">
      {/* Draggable Header */}
      <div 
        className="border-b border-sonic-gray/40 bg-sonic-dark flex-shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <div className="h-8" />
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto px-4 py-4">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={containerVariants}
            className="space-y-4"
          >
            {/* 1. Preferences */}
            <SectionCard title="Preferences">
              <div className="p-4">
                <Select
                  label="Microphone"
                  description="Select your preferred input device"
                  value={selectedMicId}
                  onChange={handleMicChange}
                  options={micOptions}
                />
                <Separator />
                <Select
                  label="Language"
                  description="Recognition language for transcription"
                  value={selectedLanguage}
                  onChange={setSelectedLanguage}
                  options={languageOptions}
                />
              </div>
            </SectionCard>

            {/* 2. Keybindings */}
            <SectionCard title="Keybindings">
              <div className="p-4">
                <ActionButton
                  label="Dictation"
                  description="Set custom hotkey for voice dictation"
                  onClick={() => handleOpenKeybindingModal('dictation')}
                />
                <Separator />
                <ActionButton
                  label="Instruction Mode"
                  description="Set custom hotkey for instruction mode"
                  onClick={() => handleOpenKeybindingModal('instruction')}
                />
              </div>
            </SectionCard>

            {/* 3. System */}
            <SectionCard title="System">
              <div className="p-4">
                <Toggle
                  label="Show Floating Bar"
                  description="Display the floating dictation pill"
                  enabled={showFloatingBar}
                  onChange={setShowFloatingBar}
                />
                <Separator />
                <Toggle
                  label="Play Sounds"
                  description="Audio feedback for dictation start/stop"
                  enabled={playSounds}
                  onChange={setPlaySounds}
                />
                <Separator />
                <Toggle
                  label="Open at Login"
                  description="Automatically start Sonic Flow when you log in"
                  enabled={openAtLogin}
                  onChange={setOpenAtLogin}
                />
              </div>
            </SectionCard>

            {/* 4. Account */}
            <SectionCard title="Account">
              <div className="p-4">
                <div className="flex items-center justify-between py-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-sonic-orange rounded-full flex items-center justify-center text-sm font-bold">
                      JS
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-white">John Smith</h3>
                      <p className="text-xs text-gray-400">john.smith@example.com</p>
                    </div>
                  </div>
                  <motion.button
                    onClick={handleSignOut}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-red-600 text-white hover:bg-red-700"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    Sign Out
                  </motion.button>
                </div>
              </div>
            </SectionCard>

            {/* Footer with logo and version */}
            <motion.footer 
              variants={sectionVariants}
              className="flex items-center gap-2 pt-4 pb-2"
            >
              <img
                src="/assets/TrayTemplate.png"
                alt="Sonic Flow Icon"
                className="w-4 h-4 brightness-0 invert"
              />
              <p className="text-xs text-gray-500">v0.0.1</p>
            </motion.footer>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(HomePage);
