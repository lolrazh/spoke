import type { Context } from "hono";
import type { AudioSession } from "../ws/session";

/**
 * Runtime configuration from env vars
 */
export interface RuntimeConfig {
  stt: {
    provider: "groq" | "simplismart";
    model: string;
    language: string;
    timeoutMs: number;
    prompt: string;
  };
  llm: {
    enabled: boolean;
    provider: "groq" | "baseten" | "cerebras" | "simplismart";
    model: string;
    temperature: number;
    timeoutMs: number;
    stream: boolean;
    currentDate?: string;
  };
  edit: {
    enabled: boolean;
    provider: "groq" | "baseten" | "cerebras" | "simplismart";
    model: string;
    temperature: number;
    timeoutMs: number;
    stream: boolean;
  };
}

/**
 * Cloudflare Worker environment bindings
 */
export type Bindings = {
  // Supabase (required for auth)
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  // STT providers
  GROQ_API_KEY?: string;
  SIMPLISMART_API_KEY?: string;
  // LLM providers
  BASETEN_API_KEY?: string;
  CEREBRAS_API_KEY?: string;
  // LLM config
  ENABLE_LLM?: string; // '1' | 'true' to enable
  LLM_STREAM?: string; // '1' | 'true' to stream deltas
  LLM_MODEL?: string; // default from src/config.ts
  // Auth bypass (for dev/testing)
  SKIP_AUTH?: string; // '1' | 'true' to skip auth check
  // Analytics Engine (optional - graceful degradation if not configured)
  ANALYTICS_ENGINE?: AnalyticsEngineDataset;
};

/**
 * Timing metrics collected throughout the pipeline
 */
export interface TimingMetrics {
  wsAcceptAt: number;
  authStartAt?: number;
  authDurationMs?: number;
  authWasColdStart?: boolean;
  ocrDurationMs?: number;
  firstFrameAt?: number;
  lastFrameAt?: number;
  processingStartAt?: number;
  assembleMs?: number;
  sttDurationMs?: number;
  sttTtfbMs?: number;
  routerOverheadMs?: number;
  llmDurationMs?: number;
  llmTtfbMs?: number;
}

/**
 * Connection context passed through the pipeline
 * Replaces the 20+ closure variables in current ws.ts
 */
export interface ConnectionContext {
  // WebSocket
  server: WebSocket;
  socketClosed: boolean;

  // Environment
  env: Bindings;
  clientIP: string;
  cfColo: string;

  // Runtime config
  runtime: RuntimeConfig;

  // Session state
  session: AudioSession;
  traceId: string;

  // Auth state
  authenticated: boolean;
  userId: string | null;
  email: string | null;
  subscriptionActive: boolean;

  // Control
  abortController: AbortController | null;
  authTimeoutHandle: ReturnType<typeof setTimeout> | null;

  // Flags
  sessionActive: boolean;
  finalSent: boolean;
  completionLogged: boolean;

  // Timing
  timing: TimingMetrics;

  // Language preference
  clientLanguage?: string;
}

/**
 * Result from STT pipeline stage
 */
export interface TranscribeResult {
  text: string;
  timings: {
    startAt: number;
    headersAt: number;
    bodyDoneAt: number;
  };
  provider: string;
  model: string;
}

/**
 * Result from router decision
 */
export interface RouteDecision {
  tier: "bypass" | "default" | "advanced" | "edit";
  requiresLLM: boolean;
  provider?: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  stream?: boolean;
  triggeredRules: string[];
  reason: string;
}

/**
 * Result from LLM enhancement
 */
export interface EnhanceResult {
  text: string;
  bypassed: boolean;
  timings?: {
    startAt: number;
    headersAt: number;
    firstDeltaAt?: number;
    bodyDoneAt: number;
  };
  provider?: string;
  model?: string;
}

/**
 * Result from audio frame handling
 */
export interface AudioFrameResult {
  success: boolean;
  error?: string;
}

// Re-export Bindings type from handlers/ws for convenience
export type { Bindings } from "../handlers/ws";
