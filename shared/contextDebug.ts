export type CorrectionTrace = {
  kind: "input" | "phrase" | "word";
  source: string;
  outcome: string;
  key?: string;
  target?: string;
  path?: string;
  score?: number;
};

export type ContextDebugRun = {
  schema: 1;
  id: string;
  createdAt: string;
  expected: string;
  notes: string;
  events: { atMs: number; stage: string; data: Record<string, unknown> }[];
  image?: string;
  audio: string[];
};

export type ContextDebugOverview = {
  recording: boolean;
  setId: string | null;
  root: string;
  error?: string;
  sets: { id: string; label: string }[];
  runs: { id: string; createdAt: string; expected: string; stages: string[] }[];
};

export type ContextDebugApi = {
  start: (label: string, includeAudio: boolean) => Promise<ContextDebugOverview>;
  stop: () => Promise<ContextDebugOverview>;
  overview: (setId?: string) => Promise<ContextDebugOverview>;
  read: (setId: string, id: string) => Promise<{ run: ContextDebugRun; image?: string }>;
  annotate: (setId: string, id: string, expected: string, notes: string) => Promise<void>;
  remove: (setId: string, id: string) => Promise<void>;
  openFolder: (setId?: string) => Promise<void>;
};
