import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import ModelInstallCard from "./ModelInstallCard";

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

const baseStatus = {
  state: "not_installed" as const,
  modelId: null,
  version: null,
  downloadProgress: 0,
  downloadedBytes: 0,
  totalBytes: 0,
  error: null,
};

describe("ModelInstallCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders install button when not installed", () => {
    mockUseModelStatus.mockReturnValue({
      status: baseStatus,
      install: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ModelInstallCard />);
    expect(screen.getByText(/Install Model/i)).toBeTruthy();
  });

  it("renders progress bar when downloading", () => {
    mockUseModelStatus.mockReturnValue({
      status: {
        ...baseStatus,
        state: "downloading",
        downloadProgress: 0.5,
        downloadedBytes: 800_000_000,
        totalBytes: 1_600_000_000,
      },
      install: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ModelInstallCard />);
    expect(screen.getByText(/50%/)).toBeTruthy();
  });

  it("renders installing/verifying state", () => {
    mockUseModelStatus.mockReturnValue({
      status: { ...baseStatus, state: "installing" },
      install: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ModelInstallCard />);
    expect(screen.getByText(/Verifying download/i)).toBeTruthy();
  });

  it("renders installed state with remove button", () => {
    mockUseModelStatus.mockReturnValue({
      status: {
        ...baseStatus,
        state: "ready",
        modelId: "moonshine-v2",
        version: "0.1",
      },
      install: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ModelInstallCard />);
    expect(screen.getByText(/Remove/i)).toBeTruthy();
    expect(screen.getByText(/v0.1/)).toBeTruthy();
  });

  it("renders error state with retry button", () => {
    mockUseModelStatus.mockReturnValue({
      status: {
        ...baseStatus,
        state: "broken",
        error: "Download failed",
      },
      install: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ModelInstallCard />);
    expect(screen.getByText(/Retry/i)).toBeTruthy();
    expect(screen.getByText(/Download failed/i)).toBeTruthy();
  });

  it("shows fallback error text when broken with no error message", () => {
    mockUseModelStatus.mockReturnValue({
      status: {
        ...baseStatus,
        state: "broken",
        error: null,
      },
      install: vi.fn(),
      remove: vi.fn(),
      refresh: vi.fn(),
    });

    render(<ModelInstallCard />);
    expect(screen.getByText(/Model installation is broken/i)).toBeTruthy();
  });
});
