import { distance } from "fastest-levenshtein";
import { identifierSpellingKey } from "./identifierSpelling";

/** Accept a small replacement, never an insertion, deletion or sentence rewrite. */
export function editLearningCandidate(before: string, after: string, names: readonly string[]): { from: string; to: string } | null {
  if (before.length > 4096 || after.length > 4096 || before === after) return null;
  const pattern = /[\p{L}\p{M}\p{N}]+(?:['’+-][\p{L}\p{M}\p{N}]+)*/gu;
  const a = [...before.matchAll(pattern)];
  const b = [...after.matchAll(pattern)];
  let start = 0;
  while (start < a.length && start < b.length && a[start][0] === b[start][0]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1][0] === b[endB - 1][0]) { endA--; endB--; }
  if (endA === start || endB === start || endA - start > 3 || endB - start > 3) return null;
  let from = before.slice(a[start].index, a[endA - 1].index + a[endA - 1][0].length);
  let to = after.slice(b[start].index, b[endB - 1].index + b[endB - 1][0].length);
  if (from.length < 3 || to.length < 3 || from.length > 80 || to.length > 80) return null;
  if (before.slice(0, a[start].index) !== after.slice(0, b[start].index) ||
      before.slice(a[endA - 1].index + a[endA - 1][0].length) !== after.slice(b[endB - 1].index + b[endB - 1][0].length)) return null;
  // Names must be independently tagged on device, not merely capitalized by
  // the user. A close spelling is also required to reject semantic rewrites.
  const changedStart = b[start].index;
  const changedEnd = b[endB - 1].index + b[endB - 1][0].length;
  const taggedName = names.find(name => {
    let at = after.indexOf(name);
    while (at >= 0) {
      if (at <= changedStart && at + name.length >= changedEnd) return true;
      at = after.indexOf(name, at + 1);
    }
    return false;
  });
  if (!taggedName) return null;
  if (taggedName !== to) {
    const at = after.lastIndexOf(taggedName, changedStart);
    from = before.slice(at, at + taggedName.length - (after.length - before.length));
    to = taggedName;
  }
  if (to.length > 80 || [...to.matchAll(pattern)].length > 3) return null;
  const key = to.toLocaleLowerCase();
  const old = from.toLocaleLowerCase();
  if (/\p{N}/u.test(from + to)) {
    // A version change is not a spelling correction. Require the full spoken
    // identifier to agree, plus the independent on-device name evidence above.
    return /\p{L}/u.test(to) && identifierSpellingKey(from) === identifierSpellingKey(to)
      ? { from, to } : null;
  }
  if (distance(old, key) > Math.max(1, Math.floor(Math.max(old.length, key.length) * 0.34))) return null;
  return { from, to };
}
