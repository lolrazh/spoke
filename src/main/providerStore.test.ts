/**
 * Provider Store Tests
 *
 * Covers API-key secret hardening: secrets are never written to disk in
 * plaintext, legacy plaintext entries stay readable, and legacy entries are
 * opportunistically re-encrypted once safeStorage becomes available.
 * File I/O and Electron's `safeStorage` are mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";

// ── Mock electron safeStorage ─────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn((): boolean => true),
}));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: mocks.isEncryptionAvailable,
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
    decryptString: vi.fn((buffer: Buffer) =>
      buffer.toString("utf8").replace(/^enc:/, ""),
    ),
  },
}));

// ── Mock modelManager (pulled in for settings snapshots only) ─────────

vi.mock("./modelManager", () => ({
  getModelInstallState: vi.fn(() => "ready"),
}));

// ── Mock fs ───────────────────────────────────────────────────────────

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// ── Import after mocks ───────────────────────────────────────────────

import {
  initProviderStore,
  encodeProviderSecret,
  setProviderApiKey,
  hasProviderApiKey,
  getRequiredProviderApiKey,
} from "./providerStore";

const USER_DATA_DIR = "/tmp/test-spoke";
const SECRETS_PATH = `${USER_DATA_DIR}/stt-provider-secrets.json`;

/** Point the mocked fs at an on-disk secrets file with the given contents. */
function seedSecretsFile(secrets: Record<string, unknown>): void {
  vi.mocked(fs.existsSync).mockImplementation((p) => p === SECRETS_PATH);
  vi.mocked(fs.readFileSync).mockImplementation((p) =>
    p === SECRETS_PATH ? JSON.stringify(secrets) : "{}",
  );
}

/** Parse the secrets JSON from the most recent writeFileSync call. */
function lastWrittenSecrets(): Record<
  string,
  { storage: string; value: string }
> {
  const writes = vi
    .mocked(fs.writeFileSync)
    .mock.calls.filter(([p]) => p === SECRETS_PATH);
  expect(writes.length).toBeGreaterThan(0);
  return JSON.parse(writes[writes.length - 1][1] as string);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isEncryptionAvailable.mockReturnValue(true);
  vi.mocked(fs.existsSync).mockReturnValue(false);
  vi.mocked(fs.readFileSync).mockReturnValue("{}");
});

describe("provider secret encoding", () => {
  it("encrypts with safeStorage when encryption is available", () => {
    const secret = encodeProviderSecret("sk-test");
    expect(secret.storage).toBe("safeStorage");
    expect(secret.value).not.toContain("sk-test");
  });

  it("throws instead of falling back to plaintext when encryption is unavailable", () => {
    mocks.isEncryptionAvailable.mockReturnValue(false);
    expect(() => encodeProviderSecret("sk-test")).toThrow(
      "Secure storage unavailable; API key not saved.",
    );
  });

  it("does not write anything to disk when encryption is unavailable", () => {
    initProviderStore(USER_DATA_DIR);
    vi.mocked(fs.writeFileSync).mockClear();
    mocks.isEncryptionAvailable.mockReturnValue(false);

    expect(() => setProviderApiKey("openai-cloud", "sk-test")).toThrow(
      "Secure storage unavailable; API key not saved.",
    );
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("never persists the raw key when saving succeeds", () => {
    initProviderStore(USER_DATA_DIR);
    setProviderApiKey("openai-cloud", "sk-raw-key");

    const written = lastWrittenSecrets();
    expect(written["openai-cloud"].storage).toBe("safeStorage");
    expect(JSON.stringify(written)).not.toContain("sk-raw-key");
  });
});

describe("legacy plaintext secrets", () => {
  it("remain readable when encryption is unavailable, without rewriting the file", () => {
    mocks.isEncryptionAvailable.mockReturnValue(false);
    seedSecretsFile({
      "openai-cloud": { storage: "plainText", value: "sk-legacy" },
    });
    initProviderStore(USER_DATA_DIR);
    vi.mocked(fs.writeFileSync).mockClear();

    expect(hasProviderApiKey("openai-cloud")).toBe(true);
    expect(getRequiredProviderApiKey("openai-cloud")).toBe("sk-legacy");
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("are re-encrypted on read once encryption becomes available", () => {
    seedSecretsFile({
      "openai-cloud": { storage: "plainText", value: "sk-legacy" },
    });
    initProviderStore(USER_DATA_DIR);
    vi.mocked(fs.writeFileSync).mockClear();

    expect(getRequiredProviderApiKey("openai-cloud")).toBe("sk-legacy");

    const written = lastWrittenSecrets();
    expect(written["openai-cloud"].storage).toBe("safeStorage");
    expect(JSON.stringify(written)).not.toContain("sk-legacy");

    // The upgraded secret still decodes to the original key.
    expect(getRequiredProviderApiKey("openai-cloud")).toBe("sk-legacy");
  });
});
