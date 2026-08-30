/**
 * Enhancement Pipeline Types
 *
 * Shared enhancement types for the local Electron pipeline.
 * for the Electron main process.
 */

export type ModelTier = "bypass" | "default" | "advanced" | "edit";

export interface EnhancementConfig {
  /** Whether smart routing is enabled (if false, always use default tier) */
  routerEnabled: boolean;
  /** Default tier settings */
  provider: string;
  model: string;
  temperature: number;
  timeoutMs: number;
  /** Advanced tier settings (spelling, long text) */
  advancedProvider?: string;
  advancedModel?: string;
  advancedTemperature?: number;
  advancedTimeoutMs?: number;
  /** Edit tier settings */
  editProvider?: string;
  editModel?: string;
  editTemperature?: number;
  editTimeoutMs?: number;
}

export interface RoutingDecision {
  tier: ModelTier;
  provider?: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  triggeredRules: string[];
  reason: string;
}

export interface EnhanceResult {
  text: string;
  bypassed: boolean;
  tier?: ModelTier;
  provider?: string;
  model?: string;
}
