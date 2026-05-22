import type { CommandContext } from '@jameswomack/clitermus';
import { generate, MluxeClient, type ChatMessage } from '@jameswomack/mluxe';
import { ensureModelDownloaded } from '../lib/ensure-model.js';

const DEFAULT_MODEL = process.env.MLUXE_MODEL ?? 'mlx-community/Qwen2.5-14B-Instruct-4bit';

/**
 * /ml exec "prompt" [--model=<id>] [--max-tokens=N] [--format=text|json]
 *
 * Shells out to mlx_lm.generate (no server needed). Best for one-shot use.
 */
export async function mlExec(ctx: CommandContext): Promise<void> {
  const { prompt, model, maxTokens, format } = parseFlags(ctx.args);
  if (!prompt) {
    ctx.log('{red-fg}Usage: /ml exec "your prompt" [--model=<id>] [--max-tokens=N] [--format=text|json]{/red-fg}');
    return;
  }
  const ready = await ensureModelDownloaded(ctx, model);
  if (!ready) return;
  ctx.log(`{gray-fg}→ generate via mlx_lm.generate  model=${model}  max_tokens=${maxTokens}{/gray-fg}`);
  const t0 = Date.now();
  const result = await generate(prompt, { model, max_tokens: maxTokens });
  const ms = Date.now() - t0;
  if (result.exitCode !== 0) {
    ctx.log(`{red-fg}✗ exit ${result.exitCode}{/red-fg}`);
    if (result.stderr) ctx.log(`{gray-fg}${result.stderr.trim()}{/gray-fg}`);
    return;
  }
  if (format === 'json') {
    ctx.log(JSON.stringify({ model, prompt, output: result.text, elapsedMs: ms }, null, 2));
  } else {
    for (const line of result.text.split('\n')) ctx.log(line);
  }
  ctx.log(`{gray-fg}done in ${ms} ms{/gray-fg}`);
}

/**
 * /ml chat [opening prompt] [--model=<id>]
 *
 * Enters an interactive multi-turn chat: every line you type is sent as the
 * next user message; the model's reply is streamed back; the conversation
 * history is preserved across turns.
 *
 * Exit by pressing Escape or typing `/exit` (or `quit`, `bye`, or just `/`).
 * The mlx_lm.server process is cached across sessions of the same model.
 */
let cachedClient: MluxeClient | null = null;
let cachedClientModel: string | null = null;

/** Called from process exit handlers — best-effort shutdown of the cached mlx server. */
export function shutdownMlClients(): void {
  if (!cachedClient) return;
  // Synchronous SIGTERM via the underlying child; stopServer() is async and exit
  // won't await it, but the signal is enough for mlx_lm.server to release :8080.
  void cachedClient.stopServer();
  cachedClient = null;
  cachedClientModel = null;
}

export async function mlChat(ctx: CommandContext): Promise<void> {
  const { prompt: opening, model } = parseFlags(ctx.args);

  const ready = await ensureModelDownloaded(ctx, model);
  if (!ready) return;

  if (!cachedClient || cachedClientModel !== model) {
    if (cachedClient) await cachedClient.stopServer();
    cachedClient = new MluxeClient({
      model,
      onLog: (line, stream) => {
        // Surface anything that looks like a real problem.
        // mlx_lm logs INFO lines via the stdlib logger ("YYYY-MM-DD … - INFO - …")
        // — filter those out so we don't drown the chat in access logs.
        if (/^\d{4}-\d{2}-\d{2}.*- INFO -/.test(line)) return;
        if (/^\d{4}-\d{2}-\d{2}.*- DEBUG -/.test(line)) return;
        if (/^127\.0\.0\.1.*"(GET|POST)/.test(line)) return; // http access log
        if (/^Fetching \d+ files/.test(line)) return; // hf hub progress noise
        const color = stream === 'stderr' ? 'red-fg' : 'gray-fg';
        ctx.log(`{${color}}[mlx] ${line}{/${color}}`);
      },
    });
    cachedClientModel = model;
    ctx.log(`{gray-fg}Starting mlx_lm.server (model=${model})…{/gray-fg}`);
    ctx.progress(` {cyan-fg}⟳{/cyan-fg} {bold}Booting MLX server…{/bold} {gray-fg}(this can take 30–60s on first launch){/gray-fg}`);
    try {
      await cachedClient.startServer(180_000);
    } finally {
      ctx.progress(null);
    }
    ctx.log(`{green-fg}✓ server ready at ${cachedClient.baseUrl}{/green-fg}`);
  }

  const client = cachedClient;
  const messages: ChatMessage[] = [];

  ctx.log('');
  ctx.log(`{bold}─── chat with ${model} ───{/bold}`);
  ctx.log('{gray-fg}Type a message and press Enter. Escape or "/exit" leaves the chat.{/gray-fg}');
  ctx.log('');

  let firstTurn = opening || null;

  // Turn loop
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let userText: string | null;
    if (firstTurn) {
      userText = firstTurn;
      firstTurn = null;
      ctx.log(`{green-fg}you ›{/green-fg} ${userText}`);
    } else {
      userText = await ctx.prompt('{green-fg}you ›{/green-fg}');
    }
    if (userText === null) {
      ctx.log('{gray-fg}(chat closed){/gray-fg}');
      return;
    }
    const trimmed = userText.trim();
    if (!trimmed) continue;
    if (/^\/(exit|quit|bye)$/i.test(trimmed) || trimmed === '/') {
      ctx.log('{gray-fg}(chat closed){/gray-fg}');
      return;
    }

    messages.push({ role: 'user', content: trimmed });

    let assistantText = '';
    ctx.progress(` {cyan-fg}…{/cyan-fg} {bold}thinking…{/bold}`);
    try {
      for await (const chunk of client.chatStream(messages)) {
        if (chunk.done) break;
        assistantText += chunk.delta;
      }
    } catch (err) {
      ctx.progress(null);
      const msg = err instanceof Error ? err.message : String(err);
      const cause = err instanceof Error && err.cause ? ` (cause: ${(err.cause as Error).message ?? String(err.cause)})` : '';
      ctx.log(`{red-fg}✗ stream error: ${msg}${cause}{/red-fg}`);
      const diag = client.getDiagnostics();
      if (!diag.isRunning) {
        ctx.log(`{red-fg}  server is no longer running (lastExit=${JSON.stringify(diag.lastExit)}){/red-fg}`);
      }
      if (diag.recentOutput.length > 0) {
        ctx.log(`{gray-fg}  --- last server output ---{/gray-fg}`);
        for (const line of diag.recentOutput.slice(-15)) {
          ctx.log(`{gray-fg}  ${line}{/gray-fg}`);
        }
      }
      ctx.log(`{gray-fg}  Hint: type /exit to leave, then retry /ml chat — the client will pick a fresh port.{/gray-fg}`);
      messages.pop();
      // Server died — clear the cache so next /ml chat respawns instead of reusing a dead client
      if (!diag.isRunning && cachedClient === client) {
        cachedClient = null;
        cachedClientModel = null;
      }
      if (!diag.isRunning) return; // bail out of the loop; user can re-enter chat fresh
      continue;
    }
    ctx.progress(null);

    messages.push({ role: 'assistant', content: assistantText });
    ctx.log(`{cyan-fg}mlx ›{/cyan-fg}`);
    for (const line of assistantText.split('\n')) ctx.log(`  ${line}`);
    ctx.log('');
  }
}

interface ParsedFlags {
  prompt: string;
  model: string;
  maxTokens: number;
  format: 'text' | 'json';
}

function parseFlags(args: string[]): ParsedFlags {
  let model = DEFAULT_MODEL;
  let maxTokens = 512;
  let format: 'text' | 'json' = 'text';
  const positional: string[] = [];

  for (const a of args) {
    if (a.startsWith('--model=')) model = a.slice(8);
    else if (a.startsWith('--max-tokens=')) maxTokens = Number(a.slice(13)) || maxTokens;
    else if (a.startsWith('--format=')) {
      const f = a.slice(9);
      if (f === 'json' || f === 'text') format = f;
    } else {
      positional.push(a);
    }
  }
  return { prompt: positional.join(' '), model, maxTokens, format };
}
