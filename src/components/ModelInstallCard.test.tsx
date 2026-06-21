import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import ModelInstallCard from "./ModelInstallCard";
import type { ModelStatus } from "../types/shared";

// Mock useModelStatus hook
vi.mock("../hooks/useModelStatus", () => ({
  useModelStatus: vi.fn(),
}));

// Mock SfIcon to avoid import.meta.glob issues in tests
vi.mock("./icons/SfIcon", () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid={`sf-icon-${name}`} />
  ),
}));

import { useModelStatus } from "../hooks/useModelStatus";

const mockUseModelStatus = vi.mocked(useModelStatus);

const baseStatus: ModelStatus = {
  state: "not_installed" as const,
  family: "whisper",
  modelId: "mlx-community/whisper-large-v3-turbo-4bit",
  displayName: "Whisper large-v3 turbo 4-bit",
  version: "0f058d38170d183f9fdee07908f5b515d91793a8",
  manifestVersion: 1,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: 464_280_053,
  error: null,
};

function mockStatus(status: ModelStatus, loaded = true) {
  mockUseModelStatus.mockReturnValue({
    status,
    install: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(),
    loaded,
  });
}

describe("ModelInstallCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the install button when not installed", () => {
    mockStatus(baseStatus);

    render(<ModelInstallCard />);
    expect(screen.getByText("Whisper Large v3 Turbo")).toBeTruthy();
    expect(screen.getByText(/Recommended on-device model/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
  });

  it("renders no control until the status has loaded (no flash)", () => {
    mockStatus(baseStatus, false);

    render(<ModelInstallCard />);
    // Title/description still show, but the state-specific control does not.
    expect(screen.getByText("Whisper Large v3 Turbo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("renders progress when downloading", () => {
    mockStatus({
      ...baseStatus,
      state: "downloading",
      downloadProgress: 0.5,
      downloadedBytes: 800_000_000,
      totalBytes: 1_600_000_000,
    });

    render(<ModelInstallCard />);
    expect(screen.getByText(/50%/)).toBeTruthy();
  });

  it("renders the verifying state while installing", () => {
    mockStatus({ ...baseStatus, state: "installing" });

    render(<ModelInstallCard />);
    expect(screen.getByText("Verifying…")).toBeTruthy();
  });

  it("renders the installed state with an uninstall control", () => {
    mockStatus({ ...baseStatus, state: "ready", version: "0.1" });

    render(<ModelInstallCard />);
    expect(
      screen.getByRole("button", { name: "Uninstall model" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
  });

  it("renders the repair button when broken", () => {
    mockStatus({ ...baseStatus, state: "broken", error: "Download failed" });

    render(<ModelInstallCard />);
    expect(screen.getByRole("button", { name: "Repair" })).toBeTruthy();
    expect(screen.getByText(/Download failed/i)).toBeTruthy();
  });

  it("shows fallback error text when broken with no error message", () => {
    mockStatus({ ...baseStatus, state: "broken", error: null });

    render(<ModelInstallCard />);
    expect(screen.getByText(/Couldn't verify the model/i)).toBeTruthy();
  });
});
