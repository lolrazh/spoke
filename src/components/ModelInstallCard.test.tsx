import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import ModelInstallCard from "./ModelInstallCard";
import type { LocalModelInfo, ModelStatus } from "../types/shared";

// Mock SfIcon to avoid import.meta.glob issues in tests
vi.mock("./icons/SfIcon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid={`sf-icon-${name}`} />
  ),
}));

const info: LocalModelInfo = {
  modelId: "spokedotso/cohere-transcribe-03-2026-mlx-4bit",
  family: "cohere",
  displayName: "Cohere Transcribe 4-bit",
  tagline: "Most accurate and fastest. 14 languages.",
  languageCount: 14,
  totalBytes: 1_600_000_000,
  isDefault: true,
};

const baseStatus: ModelStatus = {
  state: "not_installed",
  family: "cohere",
  modelId: info.modelId,
  displayName: info.displayName,
  version: null,
  manifestVersion: null,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: info.totalBytes,
  error: null,
};

function renderCard(
  overrides: {
    status?: Partial<ModelStatus>;
    isActive?: boolean;
    loaded?: boolean;
  } = {},
) {
  const props = {
    info,
    status: { ...baseStatus, ...overrides.status },
    isActive: overrides.isActive ?? false,
    loaded: overrides.loaded ?? true,
    onInstall: vi.fn(),
    onRemove: vi.fn(),
    onActivate: vi.fn(),
  };
  render(<ModelInstallCard {...props} />);
  return props;
}

describe("ModelInstallCard", () => {
  it("renders the install button + tagline when not installed", () => {
    renderCard();
    expect(screen.getByText("Cohere Transcribe 4-bit")).toBeTruthy();
    expect(screen.getByText(/Most accurate and fastest/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
  });

  it("renders no control until loaded (no flash)", () => {
    renderCard({ loaded: false });
    expect(screen.getByText("Cohere Transcribe 4-bit")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("renders progress when downloading", () => {
    renderCard({
      status: {
        state: "downloading",
        downloadProgress: 0.5,
        downloadedBytes: 800_000_000,
        totalBytes: 1_600_000_000,
      },
    });
    expect(screen.getByText(/50%/)).toBeTruthy();
  });

  it("renders the verifying state while installing", () => {
    renderCard({ status: { state: "installing" } });
    expect(screen.getByText("Verifying…")).toBeTruthy();
  });

  it("offers a Use control for a ready but inactive model", () => {
    renderCard({ status: { state: "ready" }, isActive: false });
    expect(screen.getByRole("button", { name: "Use" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Uninstall model" }),
    ).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("shows Active (no Use) for the active model", () => {
    renderCard({ status: { state: "ready" }, isActive: true });
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Uninstall model" }),
    ).toBeTruthy();
  });

  it("renders the repair button when broken", () => {
    renderCard({ status: { state: "broken", error: "Download failed" } });
    expect(screen.getByRole("button", { name: "Repair" })).toBeTruthy();
    expect(screen.getByText(/Download failed/i)).toBeTruthy();
  });

  it("shows fallback error text when broken with no message", () => {
    renderCard({ status: { state: "broken", error: null } });
    expect(screen.getByText(/Couldn't verify the model/i)).toBeTruthy();
  });
});
