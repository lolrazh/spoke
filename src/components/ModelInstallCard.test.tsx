import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
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
  tagline: "Multilingual speech recognition tuned for accuracy at 4-bit precision.",
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
  it("shows a download affordance + tagline and installs on row click when not installed", () => {
    const props = renderCard();
    expect(screen.getByText("Cohere Transcribe 4-bit")).toBeTruthy();
    expect(screen.getByText(/Multilingual speech recognition/i)).toBeTruthy();
    // No buttons (no "Install"/"Use") — the whole row is the affordance.
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    // The row itself is the clickable button; clicking it installs.
    const row = screen.getByRole("button", { name: info.displayName });
    fireEvent.click(row);
    expect(props.onInstall).toHaveBeenCalledTimes(1);
  });

  it("renders no clickable control until loaded (no flash)", () => {
    renderCard({ loaded: false });
    expect(screen.getByText("Cohere Transcribe 4-bit")).toBeTruthy();
    // Until loaded the row is inert (a plain group, not a button).
    expect(
      screen.queryByRole("button", { name: info.displayName }),
    ).toBeNull();
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

  it("shows a dim 'click to use' check for a ready but inactive model and activates on row click", () => {
    const props = renderCard({ status: { state: "ready" }, isActive: false });
    // The inactive check is labelled as the click-to-use affordance, not "Active".
    expect(
      screen.getByRole("img", { name: "Installed, click to use" }),
    ).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Uninstall model" }),
    ).toBeTruthy();

    // Row click activates the model.
    fireEvent.click(screen.getByRole("button", { name: info.displayName }));
    expect(props.onActivate).toHaveBeenCalledTimes(1);
  });

  it("uninstall click does not also activate the model (stopPropagation)", () => {
    const props = renderCard({ status: { state: "ready" }, isActive: false });
    fireEvent.click(screen.getByRole("button", { name: "Uninstall model" }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it("shows a full check (no 'Active' text, no 'Use') for the active model and the row is inert", () => {
    const props = renderCard({ status: { state: "ready" }, isActive: true });
    expect(screen.getByRole("img", { name: "Active" })).toBeTruthy();
    expect(screen.queryByText("Active")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Uninstall model" }),
    ).toBeTruthy();
    // The active row is not a clickable button (no-op).
    expect(
      screen.queryByRole("button", { name: info.displayName }),
    ).toBeNull();
    expect(props.onActivate).not.toHaveBeenCalled();
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
