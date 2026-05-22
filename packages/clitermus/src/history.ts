import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface HistoryOptions {
  /** Absolute file path to persist to. Defaults to ~/.clitermus-history */
  file?: string;
  /** Maximum entries kept (default 200) */
  max?: number;
}

/**
 * Persistent, prefix-filtered command history.
 *
 *   push()  → append (dedup against immediately-previous entry)
 *   up()    → move backwards in history; if a savedInput was set, only return
 *             entries that start with it.
 *   down()  → move forwards; once past the newest entry, restore savedInput.
 */
export class History {
  private entries: string[] = [];
  private index = -1;
  private savedInput = '';
  private readonly file: string;
  private readonly max: number;

  constructor(opts: HistoryOptions = {}) {
    this.file = opts.file ?? path.join(os.homedir(), '.clitermus-history');
    this.max = opts.max ?? 200;
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        this.entries = fs.readFileSync(this.file, 'utf-8').split('\n').filter(Boolean);
      }
    } catch {
      /* ignore */
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.file, this.entries.join('\n') + '\n');
    } catch {
      /* ignore */
    }
  }

  push(entry: string): void {
    const trimmed = entry.trim();
    if (!trimmed) return;
    if (this.entries[this.entries.length - 1] === trimmed) return;
    this.entries.push(trimmed);
    if (this.entries.length > this.max) this.entries = this.entries.slice(-this.max);
    this.save();
    this.index = -1;
    this.savedInput = '';
  }

  /** Begin browsing — capture the current input so we can restore it later. */
  beginBrowse(currentInput: string): void {
    if (this.index === -1) this.savedInput = currentInput;
  }

  /**
   * Move backwards through history. If `prefix` is non-empty, only return
   * entries that start with it. Returns the entry to display, or null if
   * already at the oldest matching entry.
   */
  up(prefix: string): string | null {
    if (this.entries.length === 0) return null;
    const start = this.index === -1 ? this.entries.length - 1 : this.index - 1;
    for (let i = start; i >= 0; i--) {
      const e = this.entries[i]!;
      if (!prefix || e.startsWith(prefix)) {
        this.index = i;
        return e;
      }
    }
    return null;
  }

  /**
   * Move forwards. If we walk past the newest match, return the saved input
   * (and reset index). Returns null if not currently browsing.
   */
  down(prefix: string): string | null {
    if (this.index === -1) return null;
    for (let i = this.index + 1; i < this.entries.length; i++) {
      const e = this.entries[i]!;
      if (!prefix || e.startsWith(prefix)) {
        this.index = i;
        return e;
      }
    }
    // Walked past the end
    this.index = -1;
    const saved = this.savedInput;
    this.savedInput = '';
    return saved;
  }

  reset(): void {
    this.index = -1;
    this.savedInput = '';
  }

  isBrowsing(): boolean {
    return this.index !== -1;
  }

  all(): readonly string[] {
    return this.entries;
  }
}
