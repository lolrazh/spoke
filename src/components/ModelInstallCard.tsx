import React from "react";
import { useModelStatus } from "../hooks/useModelStatus";
import type { ModelStatus } from "../types/shared";
import { Button } from "./ui/button";
import SettingsCard from "./SettingsCard";
import SfIcon from "./icons/SfIcon";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getModelDescription(status: ModelStatus): string {
  switch (status.state) {
    case "not_installed":
      return "Install the local Moonshine model for offline transcription.";
    case "downloading":
      return "Downloading model assets.";
    case "installing":
      return "Verifying download…";
    case "ready":
      return `Ready for local transcription${status.version ? ` (v${status.version})` : ""}.`;
    case "broken":
      return (
        status.error || "Model installation is broken. Retry the download."
      );
    default:
      return "Manage the local transcription model.";
  }
}

interface ModelInstallCardProps {
  inGroup?: boolean;
}

const ModelInstallCard: React.FC<ModelInstallCardProps> = ({ inGroup }) => {
  const { status, install, remove } = useModelStatus();
  const progressPercent = Math.round(status.downloadProgress * 100);

  return (
    <SettingsCard
      title="Local Model"
      description={getModelDescription(status)}
      icon={
        <SfIcon
          name="point.3.filled.connected.trianglepath.dotted"
          size={16}
          className="text-primary/70"
        />
      }
      inGroup={inGroup}
    >
      {status.state === "not_installed" && (
        <Button type="button" variant="secondary" size="sm" onClick={install}>
          Install Model
        </Button>
      )}

      {status.state === "downloading" && (
        <div className="ml-2 w-44 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-white/70 tabular-nums">
              {progressPercent}%
            </span>
            {status.totalBytes > 0 && (
              <span className="text-[10px] text-white/50 tabular-nums">
                {formatBytes(status.downloadedBytes)} /{" "}
                {formatBytes(status.totalBytes)}
              </span>
            )}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-white/60 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {status.state === "installing" && (
        <span className="text-[10px] text-white/70 animate-pulse">
          Verifying…
        </span>
      )}

      {status.state === "ready" && (
        <div className="ml-2 flex items-center gap-2">
          <span className="text-[10px] text-white/60 tabular-nums">
            Installed
          </span>
          <Button type="button" variant="secondary" size="sm" onClick={remove}>
            Remove
          </Button>
        </div>
      )}

      {status.state === "broken" && (
        <Button type="button" variant="secondary" size="sm" onClick={install}>
          Retry
        </Button>
      )}
    </SettingsCard>
  );
};

export default ModelInstallCard;
