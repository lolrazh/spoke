import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ContextDebugPanel from "./ContextDebugPanel";
import type { ContextDebugOverview, ContextDebugRun } from "../../shared/contextDebug";

afterEach(() => { delete window.contextDebug; });
function setup() {
  const overview: ContextDebugOverview = { recording: false, setId: "set-a", root: "/tmp/test", sets: [{ id: "set-a", label: "Names" }], runs: [{ id: "run-a", createdAt: new Date().toISOString(), expected: "", stages: ["correction"] }] };
  const run: ContextDebugRun = { schema: 1, id: "run-a", createdAt: new Date().toISOString(), expected: "", notes: "", audio: [], events: [{ atMs: 2, stage: "correction", data: { raw: "D flash two", corrected: "DFlash2 two", trace: [] } }] };
  const api = {
    overview: vi.fn(async () => ({ ...overview })), start: vi.fn(async () => { overview.recording = true; return { ...overview }; }), stop: vi.fn(async () => { overview.recording = false; return { ...overview }; }),
    read: vi.fn(async () => ({ run })), annotate: vi.fn(async () => undefined), remove: vi.fn(async () => undefined), openFolder: vi.fn(async () => undefined),
  };
  window.contextDebug = api;
  return api;
}
describe("debug test controls", () => {
  it("requires a deliberate start and makes audio a separate choice", async () => {
    const api = setup(); render(<ContextDebugPanel />);
    await screen.findByRole("button", { name: "Start test set" });
    expect(api.start).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Test set name"), { target: { value: "Browser names" } });
    fireEvent.click(screen.getByRole("button", { name: "Start test set" }));
    await waitFor(() => expect(api.start).toHaveBeenCalledWith("Browser names", false));
    await screen.findByText("● Saving debug runs");
    fireEvent.click(screen.getByRole("button", { name: "Stop saving" }));
    await waitFor(() => expect(api.stop).toHaveBeenCalledOnce());
  });
  it("opens a saved run and saves expected text with its stable IDs", async () => {
    const api = setup(); render(<ContextDebugPanel />);
    fireEvent.change(await screen.findByLabelText("Debug run"), { target: { value: "run-a" } });
    await screen.findByText("D flash two");
    expect(screen.getByText("DFlash2 two")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Expected text"), { target: { value: "DFlash2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save labels" }));
    await waitFor(() => expect(api.annotate).toHaveBeenCalledWith("set-a", "run-a", "DFlash2", ""));
  });
  it("shows when extracted terms did not reach final correction", async () => {
    const api = setup();
    const value = await api.read();
    value.run.events = [
      { atMs: 1, stage: "native-context", data: { source: "ocr", ocr: { text: "Use DFlash2.", selectedTerms: ["DFlash2", "NVFP4"] } } },
      { atMs: 2, stage: "context-acceptance", data: { accepted: true, terms: ["DFlash2", "NVFP4"] } },
      { atMs: 3, stage: "speech-stopped", data: { termsReady: [] } },
      { atMs: 4, stage: "correction", data: { raw: "D flash two", corrected: "D flash two", dictionary: ["SavedName"], trace: [] } },
    ];
    render(<ContextDebugPanel />);
    fireEvent.change(await screen.findByLabelText("Debug run"), { target: { value: "run-a" } });
    const label = await screen.findByText("Context handoff");
    const summary = JSON.parse(label.parentElement!.querySelector("pre")!.textContent!);
    expect(summary.ocrCharacters).toBe(12);
    expect(summary.extractedTerms).toBe(2);
    expect(summary.acceptedBySession).toBe(true);
    expect(summary.termsAtSpeechStop).toEqual([]);
    expect(summary.finalDictionaryCount).toBe(1);
    expect(summary.extractedTermsAbsentFromFinalDictionary).toEqual(["DFlash2", "NVFP4"]);
  });
});
