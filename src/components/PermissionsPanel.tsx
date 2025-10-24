import React, { useMemo } from "react";
import { motion } from "framer-motion";
import SettingsCard from "./SettingsCard";
import { Button } from "./ui/button";
import SfIcon from "./icons/SfIcon";
import { usePermissionsController } from "../state/permissionsContext";

type PermissionKey = "microphone" | "accessibility" | "inputMonitoring";

const PERMISSION_COPY: Record<
  PermissionKey,
  {
    title: string;
    description: string;
    icon: React.ReactNode;
    actionLabel: string;
  }
> = {
  microphone: {
    title: "Microphone",
    description: "Capture your voice for dictation",
    icon: (
      <SfIcon
        name="microphone.fill"
        size={18}
        className="text-primary/70"
      />
    ),
    actionLabel: "Enable Microphone",
  },
  accessibility: {
    title: "Accessibility",
    description: "Insert recognized text into your apps",
    icon: (
      <SfIcon
        name="accessibility"
        size={18}
        className="text-primary/70"
      />
    ),
    actionLabel: "Enable Accessibility",
  },
  inputMonitoring: {
    title: "Input Monitoring",
    description: "Detect your Sonic Flow hotkey",
    icon: (
      <SfIcon
        name="keyboard.badge.eye.fill"
        size={20}
        className="text-primary/70"
      />
    ),
    actionLabel: "Enable Input Monitoring",
  },
};

const containerVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      when: "beforeChildren" as const,
      staggerChildren: 0.08,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 360, damping: 32 },
  },
};

interface PermissionsPanelProps {
  onDismiss?: () => void;
}

const PermissionsPanel: React.FC<PermissionsPanelProps> = ({ onDismiss }) => {
  const {
    permissions,
    ui,
    missingPermissions,
    requestMicrophone,
    requestAccessibility,
    requestInputMonitoring,
  } = usePermissionsController();

  const allGranted = missingPermissions.length === 0;

  const permissionEntries = useMemo(() => {
    const entries: Array<{
      key: PermissionKey;
      granted: boolean;
      loading: boolean;
      justGranted: boolean;
      onRequest: () => Promise<void> | void;
    }> = [
      {
        key: "microphone",
        granted: permissions.microphone,
        loading: ui.microphone.loading,
        justGranted: ui.microphone.justGranted,
        onRequest: requestMicrophone,
      },
      {
        key: "accessibility",
        granted: permissions.accessibility,
        loading: ui.accessibility.loading,
        justGranted: ui.accessibility.justGranted,
        onRequest: requestAccessibility,
      },
      {
        key: "inputMonitoring",
        granted: permissions.inputMonitoring,
        loading: ui.inputMonitoring.loading,
        justGranted: ui.inputMonitoring.justGranted,
        onRequest: requestInputMonitoring,
      },
    ];

    return entries;
  }, [permissions, ui, requestMicrophone, requestAccessibility, requestInputMonitoring]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <motion.div
        className="px-6 py-5 flex flex-col gap-5 flex-1 overflow-y-auto"
        initial="hidden"
        animate="visible"
        variants={containerVariants}
      >
        <motion.div variants={itemVariants} className="space-y-2">
          <h2 className="text-base font-semibold">Mac Permissions</h2>
          <p className="text-sm text-muted-foreground">
            Sonic Flow needs these macOS permissions one time. Fix anything red
            below to get dictation working again.
          </p>
        </motion.div>

        {allGranted ? (
          <motion.div
            variants={itemVariants}
            className="rounded-lg border border-emerald-400/50 bg-emerald-500/10 px-4 py-3 text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <SfIcon name="checkmark.circle.fill" size={18} className="text-emerald-300" />
              <span className="font-medium">All permissions are granted.</span>
            </div>
            <p className="text-xs mt-1 opacity-80">
              You&apos;re all set! Sonic Flow will keep an eye on them automatically.
            </p>
          </motion.div>
        ) : null}

        <div className="space-y-3">
          {permissionEntries.map((entry) => {
            const copy = PERMISSION_COPY[entry.key];
            return (
              <motion.div key={entry.key} variants={itemVariants}>
                <SettingsCard
                  title={copy.title}
                  description={copy.description}
                  icon={copy.icon}
                  status={entry.granted ? "success" : "warning"}
                >
                  {entry.granted ? (
                    <div className="flex items-center gap-2 text-xs text-emerald-200">
                      <SfIcon name="checkmark" size={14} className="text-emerald-300" />
                      <span>Granted</span>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      disabled={entry.loading}
                      onClick={() => entry.onRequest()}
                      className="text-xs"
                    >
                      <div className="relative flex items-center justify-center h-4 w-28">
                        {entry.loading ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                        ) : (
                          <span>{copy.actionLabel}</span>
                        )}
                      </div>
                    </Button>
                  )}
                </SettingsCard>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      <div className="border-t border-border/50 px-6 py-4 flex justify-end gap-3">
        {!allGranted ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              try {
                window.electron?.openSystemPreferences?.("accessibility");
              } catch {}
            }}
          >
            Open System Settings
          </Button>
        ) : null}
        <Button size="sm" onClick={onDismiss}>
          {allGranted ? "Close" : "Done"}
        </Button>
      </div>
    </div>
  );
};

export default PermissionsPanel;

