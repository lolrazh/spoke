/** No promises on the speech path: a session only exposes results already ready. */
export class ScreenContextSession {
  private current: { id: string; frozen: boolean; terms: readonly string[] } | null = null;

  begin(id: string): void {
    this.current = { id, frozen: false, terms: [] };
  }

  accept(id: string, terms: unknown): boolean {
    const current = this.current;
    if (!current || current.id !== id || current.frozen || !Array.isArray(terms)) return false;
    const seen = new Set<string>();
    current.terms = terms.filter((term): term is string => {
      if (typeof term !== "string" || term.length < 2 || term.length > 80 ||
          !/\p{L}/u.test(term) ||
          !/^[\p{L}\p{M}\p{N} ._'’+-]+$/u.test(term)) return false;
      const key = term.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 24);
    return true;
  }

  freeze(id: string): void {
    if (this.current?.id === id) this.current.frozen = true;
  }

  invalidate(id: string): void {
    if (this.current?.id === id) this.current.terms = [];
  }

  read(id?: string): readonly string[] {
    return id && this.current?.id === id ? this.current.terms : [];
  }

  end(id: string): void {
    if (this.current?.id === id) this.current = null;
  }

  clear(): void { this.current = null; }
}

export const screenContextSession = new ScreenContextSession();
