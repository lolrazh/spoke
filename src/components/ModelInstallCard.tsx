import React from "react";
import { useModelStatus } from "../hooks/useModelStatus";
import { Button } from "./ui/button";
import SfIcon from "./icons/SfIcon";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const ModelInstallCard: React.FC = () => {
  const { status, install, remove } = useModelStatus();

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.04] p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-[var(--radius-md)] card-floating flex items-center justify-center shrink-0">
          <SfIcon
            name="desktopcomputer"
            size={16}
            className="text-primary/70"
          />
        </div>
        <div className="text-left min-w-0">
          <div className="text-xs font-medium text-white">Local Model</div>
        </div>
      </div>

      {status.state === "not_installed" && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/50">
            Local model not installed
          </span>
          <Button variant="secondary" size="sm" onClick={install}>
            Install Model
          </Button>
        </div>
      )}

      {status.state === "downloading" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/70">
              Downloading... {Math.round(status.downloadProgress * 100)}%
            </span>
            {status.totalBytes > 0 && (
              <span className="text-[10px] text-white/50">
                {formatBytes(status.downloadedBytes)} /{" "}
                {formatBytes(status.totalBytes)}
              </span>
            )}
          </div>
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-white/60 transition-all duration-300"
              style={{ width: `${Math.round(status.downloadProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {status.state === "installing" && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/70 animate-pulse">
            Verifying download...
          </span>
        </div>
      )}

      {status.state === "ready" && (
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/70">
            Model installed
            {status.version ? ` (v${status.version})` : ""}
          </span>
          <Button variant="secondary" size="sm" onClick={remove}>
            Remove
          </Button>
        </div>
      )}

      {status.state === "broken" && (
        <div className="space-y-1.5">
          <span className="text-[10px] text-red-400">
            {status.error || "Model installation is broken"}
          </span>
          <div>
            <Button variant="secondary" size="sm" onClick={install}>
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelInstallCard;
