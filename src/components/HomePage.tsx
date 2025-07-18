import React, { useState, useEffect, useMemo } from "react";
import { motion, Variants } from "framer-motion";

// --- Constants --- //
const VERSION = "v0.6.9";

// --- Types --- //
interface SettingSection {
  id: string;
  title: string;
  icon: React.ReactNode;
}

// --- Animation Variants --- //
const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const sectionVariants: Variants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};

// --- Helper Components --- //
const Toggle: React.FC<{ 
  enabled: boolean; 
  onChange: (enabled: boolean) => void;
  label: string;
  description?: string;
}> = ({ enabled, onChange, label, description }) => (
  <div className="flex items-center justify-between">
    <div className="flex-1">
      <div className="text-sm font-medium text-white">{label}</div>
      {description && (
        <div className="text-xs text-gray-400 mt-0.5">{description}</div>
      )}
    </div>
    <motion.button
      className={`relative w-11 h-6 rounded-full transition-colors ${
        enabled ? "bg-sonic-orange" : "bg-sonic-gray/60"
      }`}
      onClick={() => onChange(!enabled)}
      whileTap={{ scale: 0.95 }}
    >
      <motion.div
        className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm"
        animate={{ x: enabled ? 22 : 2 }}
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
  <div>
    <div className="text-sm font-medium text-white mb-1">{label}</div>
    {description && (
      <div className="text-xs text-gray-400 mb-2">{description}</div>
    )}
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-sonic-darker border border-sonic-gray/60 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-sonic-orange focus:ring-2 focus:ring-sonic-orange/20 transition-colors"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </div>
);

const ActionButton: React.FC<{
  onClick: () => void;
  label: string;
  description?: string;
  variant?: "primary" | "secondary";
}> = ({ onClick, label, description, variant = "secondary" }) => (
  <div>
    <div className="text-sm font-medium text-white mb-1">{label}</div>
    {description && (
      <div className="text-xs text-gray-400 mb-2">{description}</div>
    )}
    <motion.button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        variant === "primary"
          ? "bg-sonic-orange text-white hover:bg-sonic-light-orange"
          : "bg-sonic-gray/60 text-white hover:bg-sonic-gray/80"
      }`}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      {label}
    </motion.button>
  </div>
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

  const sections: SettingSection[] = useMemo(() => [
    {
      id: "preferences",
      title: "Preferences",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
        </svg>
      ),
    },
    {
      id: "keybindings",
      title: "Keybindings",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
        </svg>
      ),
    },
    {
      id: "system",
      title: "System",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      id: "account",
      title: "Account",
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      ),
    },
  ], []);

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
    <div className="min-h-screen bg-sonic-darker text-white">
      {/* Header */}
      <div className="border-b border-sonic-gray/20">
        <div className="max-w-2xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3">
            <motion.div
              whileHover={{ rotate: 360 }}
              transition={{ duration: 0.7 }}
            >
              <img
                src="/assets/TrayTemplate@2x.png"
                alt="Sonic Flow Icon"
                className="w-8 h-8 brightness-0 invert"
              />
            </motion.div>
            <div>
              <h1 className="text-2xl font-semibold text-white">sonic flow</h1>
              <p className="text-sm text-gray-400">Settings</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-2xl mx-auto px-6 py-8">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={containerVariants}
          className="space-y-8"
        >
          {/* 1. Preferences */}
          <motion.section variants={sectionVariants}>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-sonic-orange/20 rounded-lg text-sonic-orange">
                {sections[0].icon}
              </div>
              <h2 className="text-xl font-semibold">Preferences</h2>
            </div>
            
            <div className="bg-sonic-dark/60 rounded-xl p-6 space-y-6">
              <Select
                label="Microphone"
                description="Select your preferred input device"
                value={selectedMicId}
                onChange={handleMicChange}
                options={micOptions}
              />
              
              <Select
                label="Language"
                description="Recognition language for transcription"
                value={selectedLanguage}
                onChange={setSelectedLanguage}
                options={languageOptions}
              />
            </div>
          </motion.section>

          {/* 2. Keybindings */}
          <motion.section variants={sectionVariants}>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-sonic-orange/20 rounded-lg text-sonic-orange">
                {sections[1].icon}
              </div>
              <h2 className="text-xl font-semibold">Keybindings</h2>
            </div>
            
            <div className="bg-sonic-dark/60 rounded-xl p-6 space-y-6">
              <ActionButton
                label="Configure Dictation"
                description="Set custom hotkey for voice dictation"
                onClick={() => handleOpenKeybindingModal('dictation')}
              />
              
              <ActionButton
                label="Configure Instruction Mode"
                description="Set custom hotkey for instruction mode"
                onClick={() => handleOpenKeybindingModal('instruction')}
              />
            </div>
          </motion.section>

          {/* 3. System */}
          <motion.section variants={sectionVariants}>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-sonic-orange/20 rounded-lg text-sonic-orange">
                {sections[2].icon}
              </div>
              <h2 className="text-xl font-semibold">System</h2>
            </div>
            
            <div className="bg-sonic-dark/60 rounded-xl p-6 space-y-6">
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
              
              <Toggle
                label="Open at Login"
                description="Automatically start Sonic Flow when you log in"
                enabled={openAtLogin}
                onChange={setOpenAtLogin}
              />
            </div>
          </motion.section>

          {/* 4. Account */}
          <motion.section variants={sectionVariants}>
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-sonic-orange/20 rounded-lg text-sonic-orange">
                {sections[3].icon}
              </div>
              <h2 className="text-xl font-semibold">Account</h2>
            </div>
            
            <div className="bg-sonic-dark/60 rounded-xl p-6">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 bg-sonic-orange rounded-full flex items-center justify-center text-xl font-bold">
                  JS
                </div>
                <div>
                  <h3 className="text-lg font-medium">John Smith</h3>
                  <p className="text-sm text-gray-400">john.smith@example.com</p>
                  <span className="inline-block mt-1 px-2 py-1 bg-sonic-orange/20 text-sonic-orange text-xs rounded-full">
                    Pro Plan
                  </span>
                </div>
              </div>
              
              <ActionButton
                label="Sign Out"
                description="Sign out of your Sonic Flow account"
                onClick={handleSignOut}
                variant="secondary"
              />
            </div>
          </motion.section>
        </motion.div>

        {/* Footer */}
        <motion.footer 
          variants={sectionVariants}
          className="mt-12 text-center"
        >
          <p className="text-xs text-gray-500">
            Sonic Flow {VERSION} • Made with ❤️ for productivity
          </p>
        </motion.footer>
      </div>
    </div>
  );
};

export default React.memo(HomePage);
