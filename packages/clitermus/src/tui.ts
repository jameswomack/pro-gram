import blessed from 'blessed';
import type { Widgets } from 'blessed';
import { CommandPalette, type CommandSpec } from './palette.js';
import { History } from './history.js';

export interface CommandContext {
  /** Tokens after the matched command name. `/ml exec foo bar` → ['foo', 'bar'] */
  args: string[];
  /** Raw input line including the command path (no leading slash). */
  raw: string;
  /** Append a line to the log pane (blessed tags allowed). */
  log: (line: string) => void;
  /** Prompt the user for a sub-response. Resolves with the typed line, or `null` if the user pressed Escape to cancel. */
  prompt: (message: string) => Promise<string | null>;
  /**
   * Write to the activity bar (the row between the log and the input).
   * Pass `null` to clear and yield back to the default spinner.
   * Blessed tags allowed.
   */
  progress: (content: string | null) => void;
  /**
   * Open a "live region" in the log pane for streaming content (e.g. LLM
   * tokens). Each call to `write` replaces the region's content in place —
   * lines grow naturally, blessed handles wrapping, and the user reads it
   * the same way they read static log output. Call `finalize` when the
   * stream is complete so the region stops accepting writes.
   *
   * Caveat: while a stream is open, avoid `ctx.log()` from another source —
   * it interleaves and breaks the region's contiguous block of lines.
   */
  streamLines: () => LiveRegion;
  /** Manually re-render. Usually not needed — log() renders for you. */
  render: () => void;
}

export interface LiveRegion {
  /** Replace the region's content with `text` (may contain newlines). */
  write: (text: string) => void;
  /** Lock the region — further `write()` calls become no-ops. */
  finalize: () => void;
}

export interface Command extends CommandSpec {
  handler: (ctx: CommandContext) => void | Promise<void>;
}

export interface StatusItem {
  /** Short identifier; used as the React-style key. */
  id: string;
  /** Width in grid columns (0-12). Items wrap when sum > 12. */
  cols: number;
  /** Initial content. */
  content?: string;
}

export interface TuiOptions {
  title: string;
  /** Leading character for command lines (default '/'). */
  prompt?: string;
  commands: Command[];
  statusItems?: StatusItem[];
  /** Override default history file path. */
  historyFile?: string;
  /** Banner shown in the log when the TUI starts. */
  welcome?: string;
}

export interface TuiHandle {
  start(): void;
  stop(code?: number): never;
  log(line: string): void;
  setStatus(id: string, content: string): void;
  screen: Widgets.Screen;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function createTui(opts: TuiOptions): TuiHandle {
  const prompt = opts.prompt ?? '/';
  const palette = new CommandPalette(opts.commands.map(({ name, description }) => ({ name, description })));
  const history = new History({ file: opts.historyFile });
  const commandMap = new Map<string, Command>();
  for (const c of opts.commands) commandMap.set(c.name, c);

  const screen = blessed.screen({ smartCSR: true, title: opts.title, fullUnicode: true });

  const statusItems = opts.statusItems ?? [];
  const statusEls = new Map<string, Widgets.TextElement>();
  const hasStatus = statusItems.length > 0;

  let colCursor = 0;
  for (const item of statusItems) {
    const w = blessed.text({
      parent: screen,
      top: 0,
      left: `${(colCursor / 12) * 100}%`,
      width: `${(item.cols / 12) * 100}%`,
      height: 1,
      content: item.content ?? '',
      align: 'center',
      tags: true,
    });
    statusEls.set(item.id, w);
    colCursor += item.cols;
  }

  const log = blessed.box({
    parent: screen,
    top: hasStatus ? 1 : 0,
    left: 0,
    right: 0,
    bottom: 3,
    label: ` Log (PgUp/PgDn scroll · esc or q to quit) `,
    border: 'line',
    content: opts.welcome ?? `Welcome to ${opts.title}. Type ${prompt}help for commands.`,
    scrollable: true,
    alwaysScroll: true,
    tags: true,
    scrollbar: { ch: ' ', style: { inverse: true } },
    mouse: true,
  });

  const activity = blessed.text({
    parent: screen,
    bottom: 3,
    left: 0,
    right: 0,
    height: 1,
    content: '',
    tags: true,
  });

  const input = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    label: ' Command ',
    border: 'line',
    tags: true,
    mouse: true,
  });

  const suggestion = blessed.box({
    parent: screen,
    bottom: 3,
    left: 1,
    width: '60%',
    height: 0,
    tags: true,
    style: { bg: '#1a1a2e', fg: 'white', border: { fg: '#333355' } },
    border: 'line',
    hidden: true,
  });

  // ── State ─────────────────────────────────────────────────────────────────
  let inputValue = '';
  let inputCursor = 0;
  let isInSubPrompt = false;
  let didYouMean: string | null = null;
  let escapeConsumed = false;
  let spinnerTimer: ReturnType<typeof setInterval> | null = null;
  let spinnerFrame = 0;
  let spinnerLabel = '';
  /** When non-null, command-owned progress text takes the activity row from the spinner. */
  let progressOverride: string | null = null;
  /** Resolver for the current sub-prompt's escape path. */
  let currentSubPromptEscape: (() => void) | null = null;

  // Helper: add a base 'help' and 'exit' command so every consumer gets them
  if (!commandMap.has('help')) {
    const helpCmd: Command = {
      name: 'help',
      description: 'List all available commands.',
      handler({ log: l }) {
        l('{bold}Available commands:{/bold}');
        for (const c of opts.commands) l(`  ${prompt}${c.name} — {gray-fg}${c.description}{/gray-fg}`);
        l(`  ${prompt}help — show this message`);
        l(`  ${prompt}exit — quit`);
      },
    };
    commandMap.set('help', helpCmd);
  }
  if (!commandMap.has('exit')) {
    commandMap.set('exit', {
      name: 'exit',
      description: 'Quit the CLI.',
      handler() {
        stop(0);
      },
    });
  }
  // Refresh palette to include help/exit
  palette.update(
    Array.from(commandMap.values()).map(({ name, description }) => ({ name, description })),
  );

  function logLine(line: string): void {
    log.pushLine(line);
    (log as unknown as { setScrollPerc(n: number): void }).setScrollPerc(100);
    screen.render();
  }

  /**
   * Open a streaming "live region" in the log. Returns `{write, finalize}`.
   *
   * Implementation: blessed.box keeps its content as an array of lines. We
   * track the index of our region's first line, plus how many lines we own.
   * On each `write(text)`:
   *   - Split `text` by `\n` into target lines.
   *   - For each target line, either `setLine(idx+i, line)` if we already own
   *     that slot, or `pushLine(line)` if extending.
   *   - If we owned more lines previously than now (unusual), leave the tail
   *     as-is (the model output never shrinks, so this rarely matters).
   * blessed handles soft-wrapping of long lines automatically.
   */
  function streamLines(): LiveRegion {
    const logAny = log as unknown as {
      getLines(): string[];
      pushLine(s: string): void;
      setLine(i: number, s: string): void;
      setScrollPerc(n: number): void;
    };
    let firstIdx = -1;
    let ownedCount = 0;
    let done = false;

    return {
      write(text: string): void {
        if (done) return;
        const targetLines = text.split('\n');
        if (firstIdx === -1) {
          firstIdx = logAny.getLines().length;
          for (const ln of targetLines) logAny.pushLine(ln);
          ownedCount = targetLines.length;
        } else {
          for (let i = 0; i < targetLines.length; i++) {
            const ln = targetLines[i]!;
            if (i < ownedCount) {
              logAny.setLine(firstIdx + i, ln);
            } else {
              logAny.pushLine(ln);
              ownedCount++;
            }
          }
        }
        logAny.setScrollPerc(100);
        screen.render();
      },
      finalize(): void {
        done = true;
      },
    };
  }

  function setStatus(id: string, content: string): void {
    const el = statusEls.get(id);
    if (!el) return;
    el.setContent(content);
    screen.render();
  }

  function esc(s: string): string {
    return s.replace(/\{/g, '{open}').replace(/\}/g, '{close}');
  }

  // Strip the leading prompt char from an input line, return null if missing
  function asCommand(v: string): string | null {
    if (!v.startsWith(prompt)) return null;
    return v.slice(prompt.length);
  }

  function renderInput(): void {
    const v = inputValue;
    const c = inputCursor;
    const before = esc(v.slice(0, c));
    const at = esc(v[c] ?? ' ');
    const after = esc(v.slice(c + 1));

    let ghost = '';
    const cmdPart = asCommand(v);
    if (!isInSubPrompt && cmdPart !== null && c === v.length) {
      const matches = palette.getMatches(cmdPart);
      const sel = palette.getSelectedIndex();
      const top = matches[sel] ?? matches[0];
      if (top?.ghostSuffix) ghost = `{gray-fg}${esc(top.ghostSuffix)}{/gray-fg}`;
      renderDropdown(matches, cmdPart);
    } else if (!isInSubPrompt && cmdPart !== null) {
      // typing args — check command validity for did-you-mean
      const head = cmdPart.split(/\s+/)[0] ?? '';
      const hasSpace = cmdPart.includes(' ');
      if (hasSpace && !Array.from(commandMap.keys()).some((k) => k.startsWith(head))) {
        renderDidYouMean(head);
      } else {
        hideSuggestion();
      }
    } else {
      hideSuggestion();
    }

    input.setContent(`${before}{inverse}${at}{/inverse}${after}${ghost}`);
    screen.render();
  }

  function renderDropdown(matches: ReturnType<typeof palette.getMatches>, typed: string): void {
    if (matches.length === 0) {
      hideSuggestion();
      return;
    }
    const sel = palette.getSelectedIndex();
    const lines: string[] = [];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i]!;
      const isSel = i === sel;
      let display: string;
      if (m.isPrefixMatch && typed.length > 0) {
        const matched = m.name.slice(0, typed.length);
        const rest = m.name.slice(typed.length);
        display = `{bold}{white-fg}${matched}{/white-fg}{/bold}{cyan-fg}${rest}{/cyan-fg}`;
      } else {
        display = `{cyan-fg}${m.name}{/cyan-fg}`;
      }
      const pointer = isSel ? '{bold}{yellow-fg}▸{/yellow-fg}{/bold}' : ' ';
      let desc = m.description.split('.')[0] ?? '';
      if (desc.length > 50) desc = desc.slice(0, 49) + '…';
      lines.push(` ${pointer} ${prompt}${display}  {gray-fg}${desc}{/gray-fg}`);
    }
    lines.push('{gray-fg}  ↹ accept · ↑↓ cycle · ⏎ run · esc dismiss{/gray-fg}');
    suggestion.setContent(lines.join('\n'));
    suggestion.height = lines.length + 2;
    suggestion.hidden = false;
    suggestion.show();
    screen.render();
  }

  function renderDidYouMean(failed: string): void {
    const sug = palette.didYouMean(failed);
    if (sug) {
      suggestion.setContent(
        [
          `{yellow-fg}⚠{/yellow-fg}  Did you mean {bold}{cyan-fg}${prompt}${sug}{/cyan-fg}{/bold}?`,
          '{gray-fg}  ⏎ to try it · keep typing to dismiss{/gray-fg}',
        ].join('\n'),
      );
      suggestion.height = 4;
      suggestion.hidden = false;
      suggestion.show();
      didYouMean = sug;
      screen.render();
    } else {
      const domainCmds = palette.getDomainCommands(failed);
      if (domainCmds.length > 0) {
        const lines = [
          `{yellow-fg}⚠{/yellow-fg}  Commands in {bold}${failed}{/bold}:`,
          ...domainCmds.map((c) => `    {cyan-fg}${prompt}${c}{/cyan-fg}`),
        ];
        suggestion.setContent(lines.join('\n'));
        suggestion.height = lines.length + 2;
        suggestion.hidden = false;
        suggestion.show();
        screen.render();
      } else {
        hideSuggestion();
      }
      didYouMean = null;
    }
  }

  function hideSuggestion(): void {
    if (!suggestion.hidden) {
      suggestion.hide();
      suggestion.height = 0;
      palette.resetSelection();
      screen.render();
    }
  }

  function clearInput(): void {
    inputValue = '';
    inputCursor = 0;
    history.reset();
    didYouMean = null;
    hideSuggestion();
    palette.invalidateCache();
    renderInput();
  }

  function acceptGhost(): boolean {
    const cmdPart = asCommand(inputValue);
    if (cmdPart === null) return false;
    const matches = palette.getMatches(cmdPart);
    const top = matches[palette.getSelectedIndex()] ?? matches[0];
    if (top?.ghostSuffix) {
      inputValue = prompt + top.name;
      inputCursor = inputValue.length;
      hideSuggestion();
      palette.invalidateCache();
      renderInput();
      return true;
    }
    return false;
  }

  function startSpinner(label: string): void {
    spinnerLabel = label;
    spinnerFrame = 0;
    if (spinnerTimer) clearInterval(spinnerTimer);
    spinnerTimer = setInterval(() => {
      if (progressOverride !== null) return;
      const frame = SPINNER_FRAMES[spinnerFrame % SPINNER_FRAMES.length] ?? '';
      activity.setContent(` {cyan-fg}${frame}{/cyan-fg} ${spinnerLabel}`);
      screen.render();
      spinnerFrame++;
    }, 80);
  }
  function stopSpinner(): void {
    if (spinnerTimer) clearInterval(spinnerTimer);
    spinnerTimer = null;
    if (progressOverride === null) {
      activity.setContent('');
      screen.render();
    }
  }
  function progress(content: string | null): void {
    progressOverride = content;
    activity.setContent(content ?? '');
    screen.render();
  }

  async function dispatch(line: string): Promise<void> {
    const cmdPart = asCommand(line);
    if (cmdPart === null) {
      logLine(`{red-fg}Commands must start with "${prompt}". Try ${prompt}help.{/red-fg}`);
      return;
    }
    // Find the longest registered command that matches the input prefix
    let match: Command | null = null;
    let matchedName = '';
    const lower = cmdPart.toLowerCase();
    for (const c of commandMap.values()) {
      const nLow = c.name.toLowerCase();
      if (lower === nLow || lower.startsWith(nLow + ' ')) {
        if (c.name.length > matchedName.length) {
          match = c;
          matchedName = c.name;
        }
      }
    }
    if (!match) {
      const head = cmdPart.split(/\s+/)[0] ?? cmdPart;
      logLine(`{red-fg}Unknown command:{/red-fg} ${prompt}${cmdPart}`);
      const sug = palette.didYouMean(head);
      if (sug) logLine(`Did you mean {bold}{cyan-fg}${prompt}${sug}{/cyan-fg}{/bold}?`);
      else {
        const dc = palette.getDomainCommands(head);
        if (dc.length > 0) {
          logLine(`{gray-fg}Commands in ${head}:{/gray-fg}`);
          for (const c of dc) logLine(`  {cyan-fg}${prompt}${c}{/cyan-fg}`);
        }
      }
      return;
    }

    const remainder = cmdPart.slice(matchedName.length).trim();
    const args = remainder ? parseArgs(remainder) : [];
    const ctx: CommandContext = {
      args,
      raw: cmdPart,
      log: logLine,
      prompt: subPrompt,
      progress,
      streamLines,
      render: () => screen.render(),
    };
    try {
      const ret = match.handler(ctx);
      if (ret && typeof (ret as Promise<unknown>).then === 'function') {
        startSpinner(`Running ${prompt}${match.name}`);
        try {
          await ret;
        } finally {
          stopSpinner();
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logLine(`{red-fg}✗ ${prompt}${match.name} failed: ${msg}{/red-fg}`);
    }
  }

  function subPrompt(message: string): Promise<string | null> {
    return new Promise((resolve) => {
      isInSubPrompt = true;
      logLine(`{yellow-fg}? ${message}{/yellow-fg}`);
      const handler = (line: string): void => {
        offSubmit(handler);
        currentSubPromptEscape = null;
        isInSubPrompt = false;
        logLine(`{gray-fg}> ${line}{/gray-fg}`);
        resolve(line);
      };
      onSubmit(handler);
      currentSubPromptEscape = (): void => {
        offSubmit(handler);
        currentSubPromptEscape = null;
        isInSubPrompt = false;
        logLine(`{gray-fg}> (escape — cancelled){/gray-fg}`);
        resolve(null);
      };
    });
  }

  type SubmitListener = (line: string) => void;
  const submitListeners = new Set<SubmitListener>();
  function onSubmit(fn: SubmitListener): void {
    submitListeners.add(fn);
  }
  function offSubmit(fn: SubmitListener): void {
    submitListeners.delete(fn);
  }
  function emitSubmit(line: string): void {
    for (const fn of submitListeners) fn(line);
  }

  // ── Keypress handling ─────────────────────────────────────────────────────
  type KeyArg = { name: string; ctrl: boolean; meta: boolean; shift: boolean };
  screen.on('keypress', (ch: string, key: KeyArg) => {
    if (screen.focused !== input) return;
    const v = inputValue;
    const c = inputCursor;

    if (key.name === 'tab' && !isInSubPrompt) {
      if (acceptGhost()) return;
    }
    if (key.name === 'left') {
      if (c > 0) {
        inputCursor--;
        renderInput();
      }
      return;
    }
    if (key.name === 'right') {
      if (c >= v.length && !isInSubPrompt && acceptGhost()) return;
      if (c < v.length) {
        inputCursor++;
        renderInput();
      }
      return;
    }
    // Cycle matches: Alt+↑/↓, Ctrl+P/N, or plain ↑/↓ when dropdown visible
    {
      const dropdown = !suggestion.hidden;
      const wantUp = (key.meta && key.name === 'up') || (key.ctrl && key.name === 'p') ||
        (!key.meta && !key.ctrl && key.name === 'up' && dropdown);
      const wantDown = (key.meta && key.name === 'down') || (key.ctrl && key.name === 'n') ||
        (!key.meta && !key.ctrl && key.name === 'down' && dropdown);
      if ((wantUp || wantDown) && !isInSubPrompt) {
        const cmdPart = asCommand(v);
        if (cmdPart !== null) {
          const matches = palette.getMatches(cmdPart);
          if (matches.length > 0) {
            palette.moveSelection(wantUp ? 'up' : 'down', matches.length);
            renderInput();
            return;
          }
        }
      }
    }
    if (key.name === 'up') {
      history.beginBrowse(v);
      const prefix = history.isBrowsing() ? '' : v;
      const e = history.up(prefix);
      if (e !== null) {
        inputValue = e;
        inputCursor = e.length;
        renderInput();
      }
      return;
    }
    if (key.name === 'down') {
      const e = history.down('');
      if (e !== null) {
        inputValue = e;
        inputCursor = e.length;
        renderInput();
      }
      return;
    }
    if (key.name === 'escape') {
      if (isInSubPrompt && currentSubPromptEscape) {
        const cb = currentSubPromptEscape;
        currentSubPromptEscape = null;
        clearInput();
        escapeConsumed = true;
        cb();
        return;
      }
      if (!suggestion.hidden) {
        hideSuggestion();
        escapeConsumed = true;
        return;
      }
      if (v.length > 0) {
        clearInput();
        escapeConsumed = true;
        return;
      }
    }
    if (key.name === 'pageup') {
      const page = Math.max(1, (log.height as number) - 2);
      (log as unknown as { scroll(n: number): void }).scroll(-page);
      screen.render();
      return;
    }
    if (key.name === 'pagedown') {
      const page = Math.max(1, (log.height as number) - 2);
      (log as unknown as { scroll(n: number): void }).scroll(page);
      screen.render();
      return;
    }
    if (key.name === 'home' || (key.ctrl && key.name === 'a')) {
      inputCursor = 0;
      renderInput();
      return;
    }
    if (key.name === 'end' || (key.ctrl && key.name === 'e')) {
      inputCursor = v.length;
      renderInput();
      return;
    }
    if (key.name === 'backspace') {
      if (c > 0) {
        inputValue = v.slice(0, c - 1) + v.slice(c);
        inputCursor = c - 1;
        palette.resetSelection();
        palette.invalidateCache();
        renderInput();
      }
      return;
    }
    if (key.name === 'delete') {
      if (c < v.length) {
        inputValue = v.slice(0, c) + v.slice(c + 1);
        palette.resetSelection();
        palette.invalidateCache();
        renderInput();
      }
      return;
    }
    if (key.ctrl && key.name === 'u') {
      inputValue = v.slice(c);
      inputCursor = 0;
      renderInput();
      return;
    }
    if (key.ctrl && key.name === 'k') {
      inputValue = v.slice(0, c);
      renderInput();
      return;
    }
    if (key.ctrl && key.name === 'w') {
      const before = v.slice(0, c).replace(/\S+\s*$/, '');
      inputValue = before + v.slice(c);
      inputCursor = before.length;
      renderInput();
      return;
    }
    if (key.name === 'enter' || key.name === 'return') {
      // Did-you-mean priority
      if (didYouMean && !suggestion.hidden) {
        const full = prompt + didYouMean;
        didYouMean = null;
        hideSuggestion();
        inputValue = '';
        inputCursor = 0;
        renderInput();
        history.push(full);
        if (isInSubPrompt) emitSubmit(full);
        else void dispatch(full);
        return;
      }
      // Selected dropdown match
      const cmdPart = asCommand(v);
      if (!isInSubPrompt && cmdPart !== null) {
        const matches = palette.getMatches(cmdPart);
        const sel = matches[palette.getSelectedIndex()];
        if (sel && sel.ghostSuffix) {
          const full = prompt + sel.name;
          hideSuggestion();
          inputValue = '';
          inputCursor = 0;
          renderInput();
          history.push(full);
          void dispatch(full);
          return;
        }
      }
      const submitted = inputValue;
      didYouMean = null;
      hideSuggestion();
      if (submitted.trim().length > 0) history.push(submitted);
      clearInput();
      if (isInSubPrompt) emitSubmit(submitted);
      else if (submitted.trim().length > 0) void dispatch(submitted);
      return;
    }
    if (ch && !key.ctrl && !key.meta) {
      inputValue = v.slice(0, c) + ch + v.slice(c);
      inputCursor = c + 1;
      palette.resetSelection();
      palette.invalidateCache();
      renderInput();
    }
  });

  function stop(code = 0): never {
    try {
      if (spinnerTimer) clearInterval(spinnerTimer);
      screen.destroy();
    } catch {
      /* ignore */
    }
    process.exit(code);
  }

  screen.key(['escape'], () => {
    if (escapeConsumed) {
      escapeConsumed = false;
      return;
    }
    stop(0);
  });
  screen.key(['q', 'C-c'], () => stop(0));
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));

  return {
    start(): void {
      input.focus();
      renderInput();
      screen.render();
    },
    stop,
    log: logLine,
    setStatus,
    screen,
  };
}

/**
 * Token splitter: respects double-quoted strings so users can pass prompts
 * with spaces. `/ml exec "hello world"` → args = ['hello world'].
 */
export function parseArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
