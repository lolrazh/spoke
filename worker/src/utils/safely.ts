export function safely(fn: () => unknown): boolean {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}
