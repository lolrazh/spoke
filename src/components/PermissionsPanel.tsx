import React, { useMemo, useRef } from "react";
import { motion, Variants } from "framer-motion";
import SettingsCard from "./SettingsCard";
import { Button } from "./ui/button";
import SfIcon from "./icons/SfIcon";
import { MOTION } from "../config/motionTokens";
import { usePermissionsController } from "../state/permissionsContext";
import { SectionSeparator } from "./SettingsPanel";
import { usePanelAutoHeight } from "../hooks/usePanelAutoHeight";
import { ENABLE_SCREEN_CONTEXT } from "../config/featureFlags";

type PermissionKey =
  | "microphone"
  | "accessibility"
  | "inputMonitoring"
  | "screenRecording";

const PERMISSION_COPY: Record<
  PermissionKey,
  {
    title: string;
    description: string;
    icon: React.ReactNode;
  }
> = {
  microphone: {
    title: "Voice Input",
    description: "Hear your voice to transcribe what you say",
    icon: (
      <SfIcon name="microphone.fill" size={18} className="text-primary/70" />
    ),
  },
  accessibility: {
    title: "Text Insertion",
    description: "Type text directly into any app for you",
    icon: <SfIcon name="accessibility" size={18} className="text-primary/70" />,
  },
  inputMonitoring: {
    title: "Global Hotkey",
    description: "Listen for your dictation shortcut from any app",
    icon: <SfIcon name="keyboard" size={18} className="text-primary/70" />,
  },
  screenRecording: {
    title: "Smart Context",
    description: "Capture screen context for better accuracy",
    icon: <SfIcon name="record.circle" size={18} className="text-primary/70" />,
  },
};

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", ...MOTION.springs.quick },
  },
};

interface PermissionsPanelProps {
  onHeightChange?: (height: number) => void;
}

const PermissionsPanel: React.FC<PermissionsPanelProps> = ({
  onHeightChange,
}) => {
  const {
    permissions,
    ui,
    requestMicrophone,
    requestAccessibility,
    requestInputMonitoring,
    requestScreenRecording,
  } = usePermissionsController();

  const permissionEntries = useMemo(() => {
    const entries: Array<{
      key: PermissionKey;
      granted: boolean;
      loading: boolean;
      disabled: boolean;
      onRequest: () => Promise<void> | void;
    }> = [
      {
        key: "microphone",
        granted: permissions.microphone,
        loading: ui.microphone.loading,
        disabled: false,
        onRequest: requestMicrophone,
      },
      {
        key: "accessibility",
        granted: permissions.accessibility,
        loading: ui.accessibility.loading,
        disabled: false,
        onRequest: requestAccessibility,
      },
      {
        key: "inputMonitoring",
        granted: permissions.inputMonitoring,
        loading: ui.inputMonitoring.loading,
        disabled: false,
        onRequest: requestInputMonitoring,
      },
    ];

    if (ENABLE_SCREEN_CONTEXT) {
      entries.push({
        key: "screenRecording",
        granted: permissions.screenRecording,
        loading: ui.screenRecording.loading,
        disabled: false,
        onRequest: requestScreenRecording,
      });
    }

    return entries;
  }, [
    permissions,
    ui,
    requestMicrophone,
    requestAccessibility,
    requestInputMonitoring,
    requestScreenRecording,
  ]);

  const contentRef = useRef<HTMLDivElement>(null);
  usePanelAutoHeight(contentRef, onHeightChange);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div
          ref={contentRef}
          className="max-w-lg mx-auto w-full px-5 pt-4 pb-14"
        >
          <motion.div
            className="flex flex-col gap-4"
            initial="hidden"
            animate="visible"
            variants={containerVariants}
          >
            <motion.div
              variants={itemVariants}
              style={{ marginTop: "var(--panel-section-offset)" }}
            >
              <SectionSeparator title="Permissions" />
            </motion.div>
            {permissionEntries.map((entry) => {
              const copy = PERMISSION_COPY[entry.key];
              return (
                <motion.div key={entry.key} variants={itemVariants}>
                  <SettingsCard
                    title={copy.title}
                    description={copy.description}
                    icon={copy.icon}
                  >
                    {entry.granted ? (
                      <svg
                        width="22"
                        height="22"
                        viewBox="0 0 24 24"
                        className="text-white/80"
                      >
                        <path
                          d="M5 13l4 4L19 7"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <Button
                        size="sm"
                        disabled={entry.loading || entry.disabled}
                        onClick={() => entry.onRequest()}
                        className="text-xs onboarding-cta"
                      >
                        <div className="relative flex items-center justify-center h-4 w-14">
                          {entry.loading ? (
                            <div className="h-4 w-4 animate-spin will-change-transform rounded-full border-2 border-white/30 border-t-white" />
                          ) : (
                            <span>Enable</span>
                          )}
                        </div>
                      </Button>
                    )}
                  </SettingsCard>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default PermissionsPanel;
