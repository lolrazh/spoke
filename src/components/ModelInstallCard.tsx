import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LocalModelInfo, ModelStatus } from "../types/shared";
import { Button } from "./ui/button";
import SettingsCard from "./SettingsCard";
import IconButton from "./ui/IconButton";
import Spinner from "./ui/Spinner";
import { glyphForFamily } from "./ModelGlyph";
import { DownloadGlyph } from "./SettingsPanel";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) {
    return `${Math.max(0, Math.round(bytes / (1024 * 1024)))} MB`;
  }
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
}

function describe(info: LocalModelInfo, status: ModelStatus): string {
  const size = status.totalBytes > 0 ? formatBytes(status.totalBytes) : null;
  if (status.state === "broken") {
    return status.error
      ? `${status.error}. Repair downloads a clean copy.`
      : "Couldn't verify the model. Repair downloads a clean copy.";
  }
  return [info.tagline, size].filter(Boolean).join(" · ");
}

// Quiet, muted "done" checkmark — the exact path/animation the original card
// used for its ready state. `dim` renders it as a faint affordance that the
// card's group-hover brightens to full to signal "click to make active".
const InstalledCheck: React.FC<{ dim?: boolean }> = ({ dim = false }) => (
  <motion.svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    className={
      dim
        ? "text-white/30 transition-colors group-hover:text-foreground"
        : "text-muted-foreground"
    }
    role="img"
    aria-label={dim ? "Installed, click to use" : "Active"}
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
);

interface ModelInstallCardProps {
  info: LocalModelInfo;
  status: ModelStatus;
  isActive: boolean;
  loaded: boolean;
  onInstall: () => void;
  onRemove: () => void;
  onActivate: () => void;
  inGroup?: boolean;
}

const ModelInstallCard: React.FC<ModelInstallCardProps> = ({
  info,
  status,
  isActive,
  loaded,
  onInstall,
  onRemove,
  onActivate,
  inGroup,
}) => {
  const progressPercent = Math.round(status.downloadProgress * 100);

  // The whole row is the affordance: clicking a not-installed row installs it,
  // clicking a ready-but-inactive row activates it. The active row is a no-op,
  // and busy/broken rows defer to their inline controls. Only attach the click
  // once `loaded` so we never react before the real status resolves.
  const rowClick = !loaded
    ? undefined
    : status.state === "not_installed"
      ? onInstall
      : status.state === "ready" && !isActive
        ? onActivate
        : undefined;

  return (
    <SettingsCard
      title={info.displayName}
      description={describe(info, status)}
      icon={glyphForFamily(info.family)}
      inGroup={inGroup}
      interactive={rowClick !== undefined}
      onClick={rowClick}
    >
      <div className="ml-2 flex items-center justify-end">
        <AnimatePresence mode="wait" initial={false}>
          {loaded && status.state === "not_installed" && (
            <motion.div
              key="install"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-muted-foreground/60 transition-colors group-hover:text-foreground"
            >
              <DownloadGlyph />
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
              {/* Active → full check; inactive → dim check that the row's
                  group-hover brightens to signal "click to make active". */}
              <InstalledCheck dim={!isActive} />
              {/* Uninstall — stop the click bubbling so removing the model
                  doesn't also trigger the row's install/activate handler. */}
              <span onClick={(e) => e.stopPropagation()}>
                <IconButton
                  name="trash"
                  onClick={onRemove}
                  title="Uninstall"
                  ariaLabel="Uninstall model"
                  revealOnHover
                />
              </span>
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
                onClick={onInstall}
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
