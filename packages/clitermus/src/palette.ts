import { damerauLevenshtein } from './distance.js';

export interface CommandSpec {
  /** Space-separated path: 'ml exec', 'db query', 'health all'. */
  name: string;
  description: string;
}

export interface CommandMatch {
  name: string;
  description: string;
  /** Lower = better */
  score: number;
  /** Suffix to render as ghost text after the typed prefix */
  ghostSuffix: string;
  isPrefixMatch: boolean;
}

function tokenize(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

/**
 * Score a candidate command path against typed input.
 * Both inputs are space-separated paths (e.g. 'ml exec', 'ml ex').
 * Lower score = better match.
 */
function scoreMatch(typed: string, candidate: string): number {
  const t = typed.toLowerCase();
  const c = candidate.toLowerCase();

  // Empty typed = neutral score so everything shows up
  if (t.length === 0) return 5;

  // Exact prefix on the whole path — gold
  if (c.startsWith(t)) return (1 - t.length / c.length) * 9;

  // Token-aware: if user typed 'ml ex', they want commands starting with 'ml ' whose
  // next token is close to 'ex'. Score by combined token distance.
  const tToks = tokenize(t);
  const cToks = tokenize(c);
  if (tToks.length > 0 && tToks.length <= cToks.length) {
    let allPrefixed = true;
    let totalDist = 0;
    for (let i = 0; i < tToks.length; i++) {
      const tt = tToks[i]!;
      const ct = cToks[i]!;
      if (ct.startsWith(tt)) continue;
      allPrefixed = false;
      totalDist += damerauLevenshtein(tt, ct);
    }
    if (allPrefixed) return 10;
    if (totalDist <= 3) return 15 + totalDist * 4;
  }

  // Full-string Levenshtein fallback
  const dist = damerauLevenshtein(t, c);
  if (dist <= 2) return 25 + dist * 5;
  if (c.includes(t)) return 45;

  // Per-segment fuzzy
  let minSegDist = Infinity;
  for (const ts of tToks) {
    for (const cs of cToks) {
      if (ts.length > 0 && cs.length > 0) {
        minSegDist = Math.min(minSegDist, damerauLevenshtein(ts, cs));
      }
    }
  }
  if (minSegDist <= 2) return 55 + minSegDist * 3;

  return 70 + dist;
}

export class CommandPalette {
  private names: string[];
  private descs = new Map<string, string>();
  private selectedIndex = 0;
  private cachedInput: string | null = null;
  private cachedMatches: CommandMatch[] = [];

  constructor(specs: CommandSpec[]) {
    this.names = specs.map((s) => s.name);
    for (const s of specs) this.descs.set(s.name, s.description);
  }

  update(specs: CommandSpec[]): void {
    this.names = specs.map((s) => s.name);
    this.descs.clear();
    for (const s of specs) this.descs.set(s.name, s.description);
    this.invalidateCache();
  }

  /**
   * Get ranked matches for the typed input (without any leading `/`).
   * Empty input → returns all top-level command starts.
   */
  getMatches(typed: string, maxResults = 6): CommandMatch[] {
    if (typed === this.cachedInput) return this.cachedMatches;

    const matches: CommandMatch[] = [];
    const tLow = typed.toLowerCase();

    for (const name of this.names) {
      // Skip exact match — user has fully typed it
      if (tLow.length > 0 && tLow === name.toLowerCase()) continue;

      const score = scoreMatch(typed, name);
      const isPrefixMatch = name.toLowerCase().startsWith(tLow);
      const maxScore = typed.length <= 2 ? 70 : 60;
      if (score > maxScore && !isPrefixMatch) continue;

      const ghostSuffix = isPrefixMatch ? name.slice(typed.length) : '';
      matches.push({
        name,
        description: this.descs.get(name) ?? '',
        score,
        ghostSuffix,
        isPrefixMatch,
      });
    }

    matches.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    const result = matches.slice(0, maxResults);
    this.cachedInput = typed;
    this.cachedMatches = result;
    return result;
  }

  /**
   * Best correction for a command that wasn't found.
   * Returns null if nothing is close enough.
   */
  didYouMean(failed: string): string | null {
    const f = failed.toLowerCase();
    let best = '';
    let bestDist = Infinity;
    for (const name of this.names) {
      const d = damerauLevenshtein(f, name.toLowerCase());
      if (d < bestDist) {
        bestDist = d;
        best = name;
      }
    }
    const threshold = Math.max(3, Math.ceil(f.length * 0.4));
    return bestDist <= threshold && best ? best : null;
  }

  /** All commands sharing a domain (first-token) prefix. */
  getDomainCommands(domain: string): string[] {
    const d = domain.toLowerCase();
    return this.names.filter((n) => {
      const first = n.split(/\s+/)[0]?.toLowerCase() ?? '';
      return first === d;
    });
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  moveSelection(direction: 'up' | 'down', matchCount: number): number {
    if (matchCount === 0) return (this.selectedIndex = -1);
    if (direction === 'up') {
      this.selectedIndex = this.selectedIndex <= 0 ? matchCount - 1 : this.selectedIndex - 1;
    } else {
      this.selectedIndex = this.selectedIndex >= matchCount - 1 ? 0 : this.selectedIndex + 1;
    }
    return this.selectedIndex;
  }

  resetSelection(): void {
    this.selectedIndex = 0;
  }

  invalidateCache(): void {
    this.cachedInput = null;
    this.cachedMatches = [];
  }
}
