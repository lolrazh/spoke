import { BrowserWindow } from "electron";
import { state } from "./windowState";
import { saveAppPreferences } from "./preferences";
import { getVocabularyDictionary, getLearnedWords, getIgnoredLearnedWords } from "./vocabularyService";
import { editLearningCandidate } from "./editLearningCandidate";

const pending = new Map<string, { id: string; at: number }>();
const seen = new Set<string>();
let cancelledAt = 0;

export function invalidateEditLearning(): void { cancelledAt = Date.now(); }
export function editLearningEnabled(): boolean { return state.appPreferences.learnFromEdits !== false; }

export function broadcastVocabulary(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("vocabulary:changed");
  }
}

/** Raw field text exists only for this call. Only the accepted word pair persists. */
export function receiveVerifiedEdit(value: unknown): void {
  if (!editLearningEnabled() || !value || typeof value !== "object") return;
  const event = value as Record<string, unknown>;
  if (event.verified !== true || typeof event.id !== "string" || event.id.length > 80 ||
      typeof event.startedAt !== "number" || event.startedAt <= cancelledAt ||
      Date.now() - event.startedAt > 35_000 || event.startedAt > Date.now() + 1000 ||
      typeof event.before !== "string" || typeof event.after !== "string" || !Array.isArray(event.names) || seen.has(event.id)) return;
  seen.add(event.id);
  if (seen.size > 128) seen.delete(seen.values().next().value as string);
  const names = event.names.filter((name): name is string => typeof name === "string" && name.length <= 80).slice(0, 24);
  const candidate = editLearningCandidate(event.before, event.after, names);
  if (!candidate) return;
  const key = candidate.to.toLocaleLowerCase();
  const prefs = state.appPreferences;
  const learned = getLearnedWords();
  if (learned.length >= 256) return;
  if (getIgnoredLearnedWords().includes(key)) return;
  const dictionary = getVocabularyDictionary();
  if (dictionary.some(word => word.toLocaleLowerCase() === key)) return;
  const pairKey = `${candidate.from.toLocaleLowerCase()}\n${key}`;
  const previous = pending.get(pairKey);
  pending.set(pairKey, { id: event.id, at: Date.now() });
  if (pending.size > 128) pending.delete(pending.keys().next().value as string);
  if (!previous || previous.id === event.id || Date.now() - previous.at > 10 * 60_000) return;
  const next = {
    ...prefs,
    vocabularyDictionary: [...dictionary, candidate.to],
    learnedWords: [...learned.filter(word => word.to.toLocaleLowerCase() !== key),
      { ...candidate, learnedAt: Date.now() }].slice(-256),
  };
  if (!saveAppPreferences(next)) return;
  state.appPreferences = next;
  pending.delete(pairKey);
  broadcastVocabulary();
}
