import React from "react";
import { m, AnimatePresence } from "framer-motion";
import type { LocalModelInfo, ModelStatus } from "../types/shared";
import { Button } from "./ui/button";
import SettingsCard, { CardTrailing } from "./SettingsCard";
import IconButton from "./ui/IconButton";
import ProgressRing from "./ui/ProgressRing";
import Spinner from "./ui/Spinner";
import { glyphForFamily } from "./ModelGlyph";
import { DownloadGlyph } from "./SettingsPanel";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) {
    return `${Math.max(0, Math.round(bytes / (1024 * 1024)))} MB`;
  }
  const gb = bytes / (1024 * 1024 * 1024);
  const formatted = gb >= 10 ? Math.round(gb).toString() : gb.toFixed(1);
  return `${formatted.replace(/\.0$/, "")} GB`;
}

function describe(info: LocalModelInfo, status: ModelStatus): string {
  if (status.state === "broken") {
    return status.error
      ? `${status.error}. Repair downloads a clean copy.`
      : "Couldn't verify the model. Repair downloads a clean copy.";
  }
  // While downloading, show live byte progress (the ring carries the percent).
  if (status.state === "downloading") {
    return `${formatBytes(status.downloadedBytes)} / ${formatBytes(status.totalBytes)}`;
  }
  // Keep this short so the size never gets truncated behind an ellipsis; the
  // full tagline lives in onboarding where there's room.
  const size = status.totalBytes > 0 ? formatBytes(status.totalBytes) : null;
  const languages =
    info.languageCount === 1
      ? "English only"
      : `${info.languageCount} languages`;
  return [languages, info.quantization, size].filter(Boolean).join(" · ");
}

const RecommendedBadge: React.FC = () => (
  <span className="text-[10px] font-medium leading-4 text-subtle">
    Recommended
  </span>
);

// Quiet, muted "done" checkmark — the exact path/animation the original card
// used for its ready state. `dim` renders it as a faint affordance that the
// card's group-hover brightens to full to signal "click to make active".
const InstalledCheck: React.FC<{ dim?: boolean }> = ({ dim = false }) => (
  <m.svg
    width="17"
    height="17"
    viewBox="0 0 24 24"
    fill="none"
    // `transition-colors` is always present (not just on the dim variant) so
    // the shade eases smoothly in both directions — including when a model is
    // switched out of active (foreground -> dim) instead of snapping.
    className={`transition-colors duration-300 ${
      dim ? "text-white/30 group-hover:text-foreground" : "text-foreground"
    }`}
    role="img"
    aria-label={dim ? "Installed, click to use" : "Active"}
  >
    <m.path
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.45, ease: [0.25, 0.8, 0.25, 1] }}
      d="M5 13l4 4L19 7"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </m.svg>
);

interface ModelInstallCardProps {
  info: LocalModelInfo;
  status: ModelStatus;
  isActive: boolean;
  loaded: boolean;
  activationLocked?: boolean;
  isActivating?: boolean;
  onInstall: () => void;
  onRemove: () => void;
  onCancel: () => void;
  onActivate: () => void;
  inGroup?: boolean;
}

// The reveal-on-hover trash. During an install it cancels; on a ready model it
// uninstalls. Either way the click is stopped from bubbling so the row's
// install/activate handler doesn't also fire.
const TrashAction: React.FC<{
  onClick: () => void;
  title: string;
  ariaLabel: string;
}> = ({ onClick, title, ariaLabel }) => (
  <span onClick={(e) => e.stopPropagation()}>
    <IconButton
      name="trash"
      onClick={onClick}
      title={title}
      ariaLabel={ariaLabel}
      revealOnHover
    />
  </span>
);

const ModelInstallCard: React.FC<ModelInstallCardProps> = ({
  info,
  status,
  isActive,
  loaded,
  activationLocked = false,
  isActivating = false,
  onInstall,
  onRemove,
  onCancel,
  onActivate,
  inGroup,
}) => {
  // The whole row is the affordance: clicking a not-installed row installs it,
  // clicking a ready-but-inactive row activates it. The active row is a no-op,
  // and busy/broken rows defer to their inline controls. Only attach the click
  // once `loaded` so we never react before the real status resolves.
  const rowClick = !loaded || activationLocked
    ? undefined
    : status.state === "not_installed"
      ? onInstall
      : status.state === "ready" && !isActive
        ? onActivate
        : undefined;

  return (
    <SettingsCard
      title={info.displayName}
      titleAccessory={info.isDefault ? <RecommendedBadge /> : undefined}
      description={isActivating ? "Loading model…" : describe(info, status)}
      icon={glyphForFamily(info.family)}
      inGroup={inGroup}
      // Every loaded card highlights on hover for visual consistency; this is
      // decoupled from clickability, so the active (inert) row still lights up.
      interactive={loaded && !activationLocked}
      onClick={rowClick}
    >
      <div className="ml-2 flex items-center justify-end">
        <AnimatePresence mode="wait" initial={false}>
          {loaded && status.state === "not_installed" && (
            <m.div
              key="install"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* Download lives in the primary glyph column; no trailing
                  action, but its column stays reserved so the glyph aligns
                  with the check on installed rows below. */}
              <CardTrailing
                primary={
                  <span className="text-muted-foreground/60 transition-colors group-hover:text-foreground">
                    {/* Match the install check's size so the two share the
                        primary glyph column visually, not just by center. */}
                    <DownloadGlyph size={17} />
                  </span>
                }
              />
            </m.div>
          )}

          {/* downloading → installing → ready all live in this one block so the
              primary glyph swaps in place: a determinate ProgressRing that fills
              during download/verify and crossfades into the install check once
              ready. Keeping them in a single outer entry (rather than three) is
              what lets the inner AnimatePresence crossfade the glyph instead of
              the outer `mode="wait"` popping a whole new block. */}
          {(status.state === "downloading" ||
            status.state === "installing" ||
            status.state === "ready") && (
            <m.div
              key="progress"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <CardTrailing
                primary={
                  <AnimatePresence mode="popLayout" initial={false}>
                    {isActivating ? (
                      <m.span
                        key="activating"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="inline-flex"
                        role="status"
                        aria-label="Loading model"
                      >
                        <Spinner />
                      </m.span>
                    ) : status.state === "ready" ? (
                      <m.span
                        key="check"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="inline-flex"
                      >
                        {/* Active → full check; inactive → dim check that the
                            row's group-hover brightens to signal "click to make
                            active". Shares the primary glyph column with the
                            download glyph + ring so every row lines up. */}
                        <InstalledCheck dim={!isActive} />
                      </m.span>
                    ) : (
                      <m.span
                        key="ring"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="inline-flex"
                      >
                        {/* During "installing" (a brief, network-free checksum
                            verify) hold the ring at full so it reads as "done
                            downloading, finishing up" before resolving to the
                            check. */}
                        <ProgressRing
                          progress={
                            status.state === "installing"
                              ? 1
                              : status.downloadProgress
                          }
                        />
                      </m.span>
                    )}
                  </AnimatePresence>
                }
                action={
                  status.state === "ready" && !activationLocked ? (
                    <TrashAction
                      onClick={onRemove}
                      title="Uninstall"
                      ariaLabel="Uninstall model"
                    />
                  ) : (
                    // Same reveal trash, but mid-install it cancels the download
                    // (which resets the model to not_installed).
                    <TrashAction
                      onClick={onCancel}
                      title="Cancel download"
                      ariaLabel="Cancel download"
                    />
                  )
                }
              />
            </m.div>
          )}

          {status.state === "broken" && (
            <m.div
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
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </SettingsCard>
  );
};

export default ModelInstallCard;
