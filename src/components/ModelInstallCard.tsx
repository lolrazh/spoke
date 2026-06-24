import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useModelStatus } from "../hooks/useModelStatus";
import type { ModelStatus } from "../types/shared";
import { Button } from "./ui/button";
import SettingsCard from "./SettingsCard";
import IconButton from "./ui/IconButton";
import Spinner from "./ui/Spinner";

// Matches the name shown in onboarding.
const MODEL_NAME = "Whisper Large v3 Turbo";

function formatBytes(bytes: number): string {
  // Whole units, no decimals. The model is MB-scale, so 0 reads as "0 MB".
  if (bytes < 1024 * 1024 * 1024) {
    return `${Math.max(0, Math.round(bytes / (1024 * 1024)))} MB`;
  }
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
}

function getModelDescription(status: ModelStatus): string {
  const size = status.totalBytes > 0 ? formatBytes(status.totalBytes) : null;
  switch (status.state) {
    case "ready":
    case "downloading":
    case "installing":
      return ["Runs on-device", size].filter(Boolean).join(" · ");
    case "broken":
      return status.error
        ? `${status.error}. Repair downloads a clean copy.`
        : "Couldn't verify the model. Repair downloads a clean copy.";
    case "not_installed":
    default:
      return ["Recommended on-device model", size].filter(Boolean).join(" · ");
  }
}

// OpenAI logomark — Whisper is an OpenAI model (matches the onboarding row).
const OpenAiGlyph: React.FC = () => (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="currentColor"
    className="text-foreground/80"
    aria-label="OpenAI"
    role="img"
  >
    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997z" />
  </svg>
);

interface ModelInstallCardProps {
  inGroup?: boolean;
}

const ModelInstallCard: React.FC<ModelInstallCardProps> = ({ inGroup }) => {
  const { status, install, remove, loaded } = useModelStatus();
  const progressPercent = Math.round(status.downloadProgress * 100);

  return (
    <SettingsCard
      title={MODEL_NAME}
      description={getModelDescription(status)}
      icon={<OpenAiGlyph />}
      inGroup={inGroup}
      interactive={status.state === "ready"}
    >
      {/* initial={false} so the row is static on open and only animates when the
          state actually changes (mirrors the onboarding dictation tasks). */}
      <div className="ml-2 flex items-center justify-end">
        {/* Render nothing until the real status loads — avoids flashing the
            Install button before a ready model resolves. */}
        <AnimatePresence mode="wait" initial={false}>
          {loaded && status.state === "not_installed" && (
            <motion.div
              key="install"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Button
                type="button"
                size="sm"
                onClick={install}
                className="text-xs onboarding-cta"
              >
                Install
              </Button>
            </motion.div>
          )}

          {status.state === "downloading" && (
            <motion.div
              key="downloading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-44 space-y-1.5"
            >
              {/* Fixed-width slots + tabular figures so the layout never
                  reflows as digit counts change (9% -> 100%, KB -> MB). */}
              <div className="flex items-center justify-between">
                <span className="inline-block w-8 text-[10px] text-white/70 tabular-nums">
                  {progressPercent}%
                </span>
                {status.totalBytes > 0 && (
                  <span className="text-[10px] text-white/50 tabular-nums">
                    <span className="inline-block w-14 text-right">
                      {formatBytes(status.downloadedBytes)}
                    </span>{" "}
                    / {formatBytes(status.totalBytes)}
                  </span>
                )}
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-white/30 to-white/80 transition-[width] duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </motion.div>
          )}

          {status.state === "installing" && (
            <motion.div
              key="installing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="inline-flex items-center gap-2 text-[11px] text-white/70"
            >
              <Spinner className="h-3 w-3" />
              Verifying…
            </motion.div>
          )}

          {status.state === "ready" && (
            <motion.div
              key="ready"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2"
            >
              {/* Quiet, muted "done" checkmark. Draws on for in-session
                  installs. */}
              <motion.svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                className="text-muted-foreground"
                role="img"
                aria-label="Installed"
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
              {/* Uninstall — reveals on row hover, brightens on hover. Same
                  primitive as the history copy icon. */}
              <IconButton
                name="trash"
                onClick={remove}
                title="Uninstall"
                ariaLabel="Uninstall model"
                revealOnHover
              />
            </motion.div>
          )}

          {status.state === "broken" && (
            <motion.div
              key="broken"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Button
                type="button"
                size="sm"
                onClick={install}
                className="text-xs onboarding-cta"
              >
                Repair
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </SettingsCard>
  );
};

export default ModelInstallCard;
