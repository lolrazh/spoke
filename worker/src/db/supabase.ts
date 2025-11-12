import { createClient, SupabaseClient } from '@supabase/supabase-js';

type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
};

let cachedClient: SupabaseClient | null = null;

/**
 * Get or create a Supabase client for the Worker
 * Uses service role key for full database access
 */
export function getSupabaseClient(env: Env): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    console.warn('[Supabase] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    return null;
  }

  // Reuse cached client
  if (cachedClient) {
    return cachedClient;
  }

  try {
    cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    return cachedClient;
  } catch (error) {
    console.error('[Supabase] Failed to create client:', error);
    return null;
  }
}

/**
 * Count words in text (split on whitespace)
 */
function countWords(text: string | null | undefined): number {
  if (!text || typeof text !== 'string') return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export type DictationLogRow = {
  user_id: string;
  session_id: string;
  trace_id: string | null;
  created_at?: string;
  completed_at?: string;
  dictation_ms: number | null;
  e2e_ms: number | null;
  total_ms: number | null;
  ws_accept_to_final_ms: number | null;
  stt_ms: number | null;
  llm_ms: number | null;
  audio_duration_ms: number | null;
  word_count: number | null;
  pipeline: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  stt_provider: string | null;
  app_version: string | null;
  ws_close_code: number | null;
  ws_close_reason: string | null;
};

/**
 * Insert a dictation session into the database
 */
export async function insertDictationLog(
  supabase: SupabaseClient,
  data: {
    userId: string;
    sessionId: string;
    traceId: string;
    pipeline: string;
    durations: {
      dictationMs?: number | null;
      e2eMs?: number | null;
      totalMs?: number | null;
      wsAcceptToFinalMs?: number | null;
      sttMs?: number | null;
      llmMs?: number | null;
    };
    traffic: {
      firstToLastArrivalMs?: number | null;
    };
    result: {
      textLen?: number | null;
    };
    dataset?: {
      sttText?: string | null;
      llmText?: string | null;
    } | null;
    llm?: {
      provider?: string | null;
      model?: string | null;
    } | null;
    ws: {
      closeCode?: number;
      closeReason?: string;
    };
    meta?: {
      appVersion?: string;
    };
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    // Calculate word count from the result text
    const resultText = data.dataset?.llmText || data.dataset?.sttText || null;
    const wordCount = countWords(resultText);

    const row: DictationLogRow = {
      user_id: data.userId,
      session_id: data.sessionId,
      trace_id: data.traceId,
      completed_at: new Date().toISOString(),
      dictation_ms: data.durations.dictationMs ?? null,
      e2e_ms: data.durations.e2eMs ?? null,
      total_ms: data.durations.totalMs ?? null,
      ws_accept_to_final_ms: data.durations.wsAcceptToFinalMs ?? null,
      stt_ms: data.durations.sttMs ?? null,
      llm_ms: data.durations.llmMs ?? null,
      audio_duration_ms: data.traffic.firstToLastArrivalMs ?? null,
      word_count: wordCount,
      pipeline: data.pipeline || null,
      llm_provider: data.llm?.provider ?? null,
      llm_model: data.llm?.model ?? null,
      stt_provider: 'groq', // Currently hardcoded
      app_version: data.meta?.appVersion ?? null,
      ws_close_code: data.ws.closeCode ?? 1000,
      ws_close_reason: data.ws.closeReason ?? 'done',
    };

    const { error } = await supabase.from('dictation_logs').insert(row);

    if (error) {
      console.error('[Supabase] Failed to insert dictation log:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error: any) {
    console.error('[Supabase] Exception inserting dictation log:', error);
    return { success: false, error: String(error) };
  }
}
