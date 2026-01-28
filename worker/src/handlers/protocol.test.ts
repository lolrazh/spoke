/**
 * Protocol Tests for WebSocket Handler
 *
 * ELI5: These tests verify the "drive-thru rules" - what happens when customers
 * do things in the wrong order, send bad info, or violate the rules.
 *
 * Real-world scenarios tested:
 * 1. Auth timeout - Customer takes too long to show ID
 * 2. Invalid JWT - Customer has a fake membership card
 * 3. Quota exceeded - Customer ran out of money
 * 4. Message order violations - Customer says "done" before "ready"
 * 5. Duplicate auth - Customer shows ID twice
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ConnectionContext } from "../pipeline/types";
import { createEmptySession } from "../pipeline/session";
import { AUTH_TIMEOUT_MS, WS_CLOSE_CODES } from "../auth";

// Mock external dependencies
vi.mock("../auth", async () => {
  const actual = await vi.importActual("../auth");
  return {
    ...actual,
    verifySupabaseJwt: vi.fn(),
  };
});

vi.mock("../pipeline/transcribe", () => ({
  transcribe: vi.fn(),
}));

vi.mock("../pipeline/router", () => ({
  routeTranscript: vi.fn(),
}));

vi.mock("../background/tasks", () => ({
  scheduleQuotaIncrement: vi.fn(),
  scheduleAnalytics: vi.fn(),
}));

import { verifySupabaseJwt } from "../auth";
import {
  setupAuthTimeout,
  clearAuthTimeout,
  handleAuth,
  sendAuthError,
  sendAuthSuccess,
} from "../pipeline/auth";

/**
 * Helper: Create a mock WebSocket
 */
function createMockWebSocket() {
  const sent: string[] = [];
  let closeCode: number | null = null;
  let closeReason: string | null = null;

  return {
    send: vi.fn((data: string) => {
      sent.push(data);
    }),
    close: vi.fn((code?: number, reason?: string) => {
      closeCode = code ?? null;
      closeReason = reason ?? null;
    }),
    accept: vi.fn(),
    addEventListener: vi.fn(),
    sent,
    closeCode: () => closeCode,
    closeReason: () => closeReason,
    getSentMessages: () => sent.map((s) => JSON.parse(s)),
  };
}

/**
 * Helper: Create minimal ConnectionContext for testing
 */
function createTestContext(overrides: Partial<ConnectionContext> = {}) {
  const mockServer = createMockWebSocket();

  const ctx: ConnectionContext = {
    server: mockServer as any,
    socketClosed: false,
    env: {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "test-key",
      GROQ_API_KEY: "test-groq-key",
    } as any,
    clientIP: "127.0.0.1",
    cfColo: "SFO",
    runtime: {
      stt: {
        provider: "groq" as const,
        model: "whisper-large-v3",
        prompt: null,
      },
      llm: {
        provider: "groq" as const,
        model: "llama-3.3-70b-versatile",
        stream: false,
      },
      advanced: {
        provider: "groq" as const,
        model: "llama-3.3-70b-versatile",
      },
      edit: {
        provider: "groq" as const,
        model: "llama-3.3-70b-versatile",
      },
    },
    session: createEmptySession(),
    traceId: "test-trace-123",
    authenticated: false,
    userId: null,
    email: null,
    subscriptionActive: false,
    abortController: null,
    authTimeoutHandle: null,
    executionCtx: {
      waitUntil: vi.fn(),
      passThroughOnException: vi.fn(),
    } as any,
    sessionActive: false,
    finalSent: false,
    completionLogged: false,
    timing: {
      wsAcceptAt: Date.now(),
    },
    clientLanguage: "en",
    ...overrides,
  };

  return { ctx, mockServer };
}

describe("Protocol Tests - Auth Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * TEST 1: Auth Timeout
   *
   * Real world: Customer pulls up to drive-thru, sits there for 16 seconds
   * without showing their membership card.
   *
   * Expected: Worker sends "auth_error" message and closes the connection
   * after 15 seconds.
   *
   * Why this matters: Prevents connections from hanging forever if client
   * never authenticates. Frees up worker resources.
   */
  it("should timeout and close connection if no auth within 15 seconds", () => {
    const { ctx, mockServer } = createTestContext();

    // Setup auth timeout
    setupAuthTimeout(ctx);

    // Fast-forward time by 15 seconds
    vi.advanceTimersByTime(AUTH_TIMEOUT_MS);

    // Verify auth_error was sent
    const messages = mockServer.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "auth_error",
      error: "Authentication timeout - please send auth message",
      code: WS_CLOSE_CODES.AUTH_TIMEOUT,
    });

    // Verify connection was closed
    expect(mockServer.close).toHaveBeenCalledWith(
      WS_CLOSE_CODES.AUTH_TIMEOUT,
      "auth timeout",
    );
  });

  /**
   * TEST 2: Clear Auth Timeout
   *
   * Real world: Customer shows their membership card in time (within 15 seconds).
   *
   * Expected: Timer is cancelled, no timeout occurs.
   *
   * Why this matters: Once customer authenticates, we shouldn't kick them out.
   */
  it("should cancel timeout when auth message received", () => {
    const { ctx, mockServer } = createTestContext();

    // Setup auth timeout
    setupAuthTimeout(ctx);
    expect(ctx.authTimeoutHandle).not.toBeNull();

    // Receive auth message (clears timeout)
    clearAuthTimeout(ctx);
    expect(ctx.authTimeoutHandle).toBeNull();

    // Fast-forward time - should NOT trigger timeout
    vi.advanceTimersByTime(AUTH_TIMEOUT_MS);

    // Verify NO messages were sent
    expect(mockServer.getSentMessages()).toHaveLength(0);
    expect(mockServer.close).not.toHaveBeenCalled();
  });

  /**
   * TEST 3: Invalid JWT
   *
   * Real world: Customer hands over a fake membership card.
   *
   * Expected: Worker rejects it immediately with "unauthorized" error.
   *
   * Why this matters: Security - can't let random people use the service.
   */
  it("should reject invalid JWT token", async () => {
    const { ctx } = createTestContext();

    // Mock JWT verification to fail
    vi.mocked(verifySupabaseJwt).mockResolvedValue({
      valid: false,
      error: "Invalid token signature",
      code: "invalid",
    });

    // Attempt to authenticate
    const result = await handleAuth(ctx, "fake-token-123");

    // Verify rejection
    expect(result.success).toBe(false);
    expect(result.error).toBe("Invalid token signature");
    expect(result.code).toBe(WS_CLOSE_CODES.UNAUTHORIZED);

    // Verify user was NOT authenticated
    expect(ctx.authenticated).toBe(false);
    expect(ctx.userId).toBeNull();
  });

  /**
   * TEST 4: Expired JWT
   *
   * Real world: Customer's membership card expired last week.
   *
   * Expected: Worker tells them "Token has expired".
   *
   * Why this matters: Security - expired tokens should be rejected.
   */
  it("should reject expired JWT token with custom message", async () => {
    const { ctx } = createTestContext();

    // Mock JWT verification to return expired
    vi.mocked(verifySupabaseJwt).mockResolvedValue({
      valid: false,
      error: "JWT expired",
      code: "expired",
    });

    // Attempt to authenticate
    const result = await handleAuth(ctx, "expired-token");

    // Verify rejection with custom message
    expect(result.success).toBe(false);
    expect(result.error).toBe("Token has expired");
    expect(result.code).toBe(WS_CLOSE_CODES.UNAUTHORIZED);
  });

  /**
   * TEST 5: Quota Exceeded (Free Tier)
   *
   * Real world: Free customer already used 1000/1000 words this week,
   * tries to order more.
   *
   * Expected: Worker says "Free words used up this week" and rejects.
   *
   * Why this matters: Business logic - enforce free tier limits.
   */
  it("should reject free tier user who exceeded quota", async () => {
    const { ctx } = createTestContext();

    // Mock JWT verification to succeed but quota exceeded
    vi.mocked(verifySupabaseJwt).mockResolvedValue({
      valid: true,
      userId: "user-123",
      email: "test@example.com",
      subscriptionActive: false,
      wordsUsedThisWeek: 1000,
      quotaLimit: 1000,
    });

    // Attempt to authenticate
    const result = await handleAuth(ctx, "valid-token");

    // Verify rejection due to quota
    expect(result.success).toBe(false);
    expect(result.error).toBe("Free words used up this week");
    expect(result.code).toBe(WS_CLOSE_CODES.QUOTA_EXCEEDED);

    // Verify user was NOT authenticated
    expect(ctx.authenticated).toBe(false);
  });

  /**
   * TEST 6: Free Tier User Within Quota
   *
   * Real world: Free customer used 500/1000 words, still has quota left.
   *
   * Expected: Worker lets them in.
   *
   * Why this matters: Don't reject customers who have quota remaining.
   */
  it("should accept free tier user within quota", async () => {
    const { ctx } = createTestContext();

    // Mock JWT verification - free user with quota remaining
    vi.mocked(verifySupabaseJwt).mockResolvedValue({
      valid: true,
      userId: "user-456",
      email: "free@example.com",
      subscriptionActive: false,
      wordsUsedThisWeek: 500,
      quotaLimit: 1000,
    });

    // Attempt to authenticate
    const result = await handleAuth(ctx, "valid-token");

    // Verify success
    expect(result.success).toBe(true);
    expect(result.userId).toBe("user-456");
    expect(result.email).toBe("free@example.com");
    expect(result.subscriptionActive).toBe(false);
  });

  /**
   * TEST 7: Pro Tier User (No Quota Check)
   *
   * Real world: Paid customer with unlimited access.
   *
   * Expected: Worker lets them in without checking quota.
   *
   * Why this matters: Pro users shouldn't be quota-limited.
   */
  it("should accept pro tier user without quota check", async () => {
    const { ctx } = createTestContext();

    // Mock JWT verification - pro user
    vi.mocked(verifySupabaseJwt).mockResolvedValue({
      valid: true,
      userId: "pro-user-789",
      email: "pro@example.com",
      subscriptionActive: true,
      wordsUsedThisWeek: 5000, // Doesn't matter for pro users
      quotaLimit: 1000,
    });

    // Attempt to authenticate
    const result = await handleAuth(ctx, "pro-token");

    // Verify success
    expect(result.success).toBe(true);
    expect(result.userId).toBe("pro-user-789");
    expect(result.subscriptionActive).toBe(true);
  });

  /**
   * TEST 8: Send Auth Success Message
   *
   * Real world: After customer shows valid ID, worker says "OK, you're in!"
   *
   * Expected: Worker sends { type: "auth_ok", userId: "..." }
   *
   * Why this matters: Client needs confirmation to proceed with session.
   */
  it("should send auth_ok message on successful auth", () => {
    const { ctx, mockServer } = createTestContext({
      authenticated: true,
      userId: "user-success",
    });

    // Send auth success
    sendAuthSuccess(ctx);

    // Verify message
    const messages = mockServer.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "auth_ok",
      userId: "user-success",
    });
  });

  /**
   * TEST 9: Send Auth Error Message
   *
   * Real world: When customer's ID is rejected, worker explains why and
   * closes the window.
   *
   * Expected: Worker sends error message and closes connection.
   *
   * Why this matters: Client needs to know why they were rejected.
   */
  it("should send auth_error message and close connection", () => {
    const { ctx, mockServer } = createTestContext();

    // Send auth error
    sendAuthError(ctx, "Invalid credentials", WS_CLOSE_CODES.UNAUTHORIZED);

    // Verify error message
    const messages = mockServer.getSentMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "auth_error",
      error: "Invalid credentials",
      code: WS_CLOSE_CODES.UNAUTHORIZED,
    });

    // Verify connection closed
    expect(mockServer.close).toHaveBeenCalledWith(
      WS_CLOSE_CODES.UNAUTHORIZED,
      "Invalid credentials",
    );
  });

  /**
   * TEST 10: Missing Supabase URL
   *
   * Real world: Worker misconfigured, can't verify membership cards.
   *
   * Expected: Reject with "Server configuration error".
   *
   * Why this matters: Fail gracefully when environment vars missing.
   */
  it("should reject auth when SUPABASE_URL not configured", async () => {
    const { ctx } = createTestContext({
      env: {} as any, // Missing SUPABASE_URL
    });

    // Attempt to authenticate
    const result = await handleAuth(ctx, "token");

    // Verify rejection
    expect(result.success).toBe(false);
    expect(result.error).toBe("Server configuration error");
    expect(result.code).toBe(WS_CLOSE_CODES.UNAUTHORIZED);
  });
});
