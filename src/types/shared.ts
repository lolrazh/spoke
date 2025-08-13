export type AuthProvider = "google" | "email";

export type AuthCallbackPayload = {
  url: string;
};

export type MicDevice = { id: string; label: string };

export type MicPreferences = { selectedMicId?: string };

export type PttTarget = "auto" | "onboarding" | "main";

// Shared IPC payload types
export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

export type ActiveDisplayPayload = {
  id: number;
  bounds: Rect;
  size: Size;
  workArea: Rect;
  scaleFactor: number;
  scale: number;
  window: Rect | null;
};
