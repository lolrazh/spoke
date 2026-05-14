import React from "react";
import { useModelStatus } from "../hooks/useModelStatus";
import type { ModelStatus } from "../types/shared";
import { Button } from "./ui/button";
import SettingsCard from "./SettingsCard";
import SfIcon from "./icons/SfIcon";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function shortVersion(version: string | null): string | null {
  if (!version) return null;
  return version.length > 12 ? version.slice(0, 7) : version;
}

function getModelName(status: ModelStatus): string {
  return status.displayName || "Whisper large-v3 turbo 4-bit";
}

function getStateLabel(status: ModelStatus): string {
  switch (status.state) {
    case "not_installed":
      return "Not installed";
    case "downloading":
      return "Downloading";
    case "installing":
      return "Verifying";
    case "ready":
      return "Ready";
    case "broken":
      return "Needs repair";
    default:
      return "Local";
  }
}

function getModelDescription(status: ModelStatus): string {
  const size = status.totalBytes > 0 ? formatBytes(status.totalBytes) : null;
  const version = shortVersion(status.version);

  if (status.state === "broken") {
    return status.error || "Model installation is broken. Retry the download.";
  }

  const metadata = [
    getStateLabel(status),
    status.state === "ready" ? "Offline transcription enabled" : null,
    status.state === "not_installed" && size ? `${size} download` : null,
    status.state !== "not_installed" && size ? size : null,
    version ? `rev ${version}` : null,
  ].filter(Boolean);

  switch (status.state) {
    case "not_installed":
      return metadata.join(" • ");
    case "downloading":
      return metadata.join(" • ");
    case "installing":
      return metadata.join(" • ");
    case "ready":
      return metadata.join(" • ");
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
  const stateLabel = getStateLabel(status);

  return (
    <SettingsCard
      title={getModelName(status)}
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
      <div className="ml-2 flex items-center gap-2">
        {status.state !== "downloading" && (
          <span className="hidden rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-1 text-[10px] text-white/60 sm:inline-flex">
            {stateLabel}
          </span>
        )}

        {status.state === "not_installed" && (
          <Button type="button" variant="secondary" size="sm" onClick={install}>
            Install
          </Button>
        )}

        {status.state === "downloading" && (
          <div className="w-44 space-y-1.5">
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
          <Button type="button" variant="secondary" size="sm" onClick={remove}>
            Remove
          </Button>
        )}

        {status.state === "broken" && (
          <Button type="button" variant="secondary" size="sm" onClick={install}>
            Retry
          </Button>
        )}
      </div>
    </SettingsCard>
  );
};

export default ModelInstallCard;
