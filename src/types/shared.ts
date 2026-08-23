export type MicDevice = { id: string; label: string };

export type MicPreferences = { selectedMicId?: string };

export type PillPreferences = { notchWidth?: number };

export type AppPreferences = {
  showInDock?: boolean;
  autoSpace?: boolean;
  vocabularyDictionary?: string[];
};

export type PttTarget = "auto" | "onboarding" | "main";

export type SelectionRange = { location: number; length: number };

export type SelectionInspectSnapshot = {
  ok: boolean;
  status: string;
  range: SelectionRange | null;
  selectedText: string | null;
  context: string | null;
  valueLength: number | null;
  hadSelection: boolean;
  source: "ax" | "clipboard" | "none";
  rawOutput: string;
  error?: string;
};

// Shared IPC payload types
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };
export type EdgeInsets = {
  top: number;
  left: number;
  bottom: number;
  right: number;
};

export type DisplayNotchInfo = {
  id: number;
  isBuiltIn: boolean;
  hasNotch: boolean;
  notchWidth: number;
  notchCenterX: number;
  menuBarHeight: number;
  frame: Rect;
  visibleFrame: Rect;
  safeAreaInsets: EdgeInsets;
  auxiliaryLeft: Rect | null;
  auxiliaryRight: Rect | null;
  scaleFactor: number;
  timestamp: number;
};

export type ActiveDisplayPayload = {
  id: number;
  bounds: Rect;
  size: Size;
  workArea: Rect;
  scaleFactor: number;
  scale: number;
  window: Rect | null;
  notch?: DisplayNotchInfo | null;
  storedNotchWidth?: number | null;
};

// MLX Whisper daemon protocol (JSON lines on stdout)
export interface SttPartialEvent {
  type: "partial";
  text: string;
}

export interface SttErrorEvent {
  type: "error";
  message: string;
  code?: string;
}

export interface SttDoneEvent {
  type: "done";
  transcript: string;
  metrics: {
    model_load_ms: number;
    audio_duration_ms: number;
    inference_ms: number;
    ttft_ms: number | null;
    word_count: number;
  } & Record<string, unknown>;
}

export type SttEvent = SttPartialEvent | SttDoneEvent | SttErrorEvent;

// IPC result from main → renderer
export interface LocalTranscribeResult {
  text: string;
  metrics?: SttDoneEvent["metrics"] & Record<string, unknown>;
}

// Transcription history types
export type TranscriptionItem = {
  id: string;
  text: string;
  timestamp: number; // Unix timestamp in ms
  mode: "dictation" | "edit";
};

/**
 * Maximum number of transcription history items retained on disk and mirrored
 * in memory. Bounds the JSON store to a few hundred KB so full loads stay cheap.
 */
export const MAX_TRANSCRIPTION_HISTORY = 2000;

// ── Model Management ───────────────────────────────────────────────────

export type ModelInstallState =
  | "not_installed"
  | "downloading"
  | "installing"
  | "ready"
  | "broken";

export type LocalModelFamily =
  | "whisper"
  | "cohere"
  | "parakeet"
  | "nemotron";

export type ModelStatus = {
  state: ModelInstallState;
  family: LocalModelFamily | null;
  modelId: string | null;
  displayName: string | null;
  version: string | null;
  manifestVersion: number | null;
  downloadProgress: number; // 0-1
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
};

export type ModelManifestFileRole =
  | "config"
  | "weights"
  | "tokenizer"
  | "aux";

export type ModelManifestFile = {
  role: ModelManifestFileRole;
  path: string;
  url: string;
  sha256: string;
  size: number; // bytes
};

export type ModelManifest = {
  manifestVersion: number;
  family: LocalModelFamily;
  modelId: string;
  displayName: string;
  version: string;
  files: ModelManifestFile[];
};

/**
 * UI-facing descriptor for a selectable local model. The download contract
 * lives in ModelManifest; this carries the metadata the picker needs.
 */
export type LocalModelInfo = {
  modelId: string;
  family: LocalModelFamily;
  displayName: string;
  /** Short one-line description shown under the model name. */
  tagline: string;
  /** Approximate number of supported languages, for UI ("99 languages"). */
  languageCount: number;
  /** Quantization / precision label shown with size metadata ("4-bit"). */
  quantization: string;
  /** Sum of manifest file sizes, in bytes. */
  totalBytes: number;
  /** True for the model pre-selected in onboarding / for fresh installs. */
  isDefault: boolean;
  /** True when this model accepts live PCM and returns cumulative partials. */
  streaming: boolean;
};
