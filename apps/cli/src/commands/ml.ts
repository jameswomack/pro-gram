import type { CommandContext } from '@jameswomack/clitermus';
import { generate, MluxeClient, type ChatMessage } from '@jameswomack/mluxe';
import { ensureModelDownloaded } from '../lib/ensure-model.js';

/**
 * Friendly aliases that expand to full HF repo ids. Lets users say
 * `--model=qwen-7b` instead of `--model=mlx-community/Qwen2.5-7B-Instruct-4bit`.
 *
 * Smaller models trade quality for speed; 0.5B is the canonical draft-model
 * partner for speculative decoding against the 14B main.
 */
export const MODEL_ALIASES: Readonly<Record<string, string>> = {
  'qwen-14b': 'mlx-community/Qwen2.5-14B-Instruct-4bit',
  'qwen-7b': 'mlx-community/Qwen2.5-7B-Instruct-4bit',
  'qwen-3b': 'mlx-community/Qwen2.5-3B-Instruct-4bit',
  'qwen-1.5b': 'mlx-community/Qwen2.5-1.5B-Instruct-4bit',
  'qwen-0.5b': 'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
};

const DEFAULT_MODEL = resolveModelAlias(process.env.MLUXE_MODEL ?? 'qwen-14b');
const DEFAULT_DRAFT_MODEL =
  process.env.MLUXE_DRAFT_MODEL !== undefined
    ? resolveModelAlias(process.env.MLUXE_DRAFT_MODEL) || undefined
    : undefined;

function resolveModelAlias(idOrAlias: string): string {
  return MODEL_ALIASES[idOrAlias.toLowerCase()] ?? idOrAlias;
}

/**
 * /ml exec "prompt" [--model=<id|alias>] [--max-tokens=N] [--format=text|json]
 *
 * Shells out to mlx_lm.generate (no server needed). Best for one-shot use.
 */
export async function mlExec(ctx: CommandContext): Promise<void> {
  const { prompt, model, maxTokens, format } = parseFlags(ctx.args);
  if (!prompt) {
    ctx.log('{red-fg}Usage: /ml exec "your prompt" [--model=<id|alias>] [--max-tokens=N] [--format=text|json]{/red-fg}');
    ctx.log(`{gray-fg}Aliases: ${Object.keys(MODEL_ALIASES).join(', ')}{/gray-fg}`);
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
 * /ml chat [opening prompt]
 *   [--model=<id|alias>]
 *   [--draft=<id|alias>]              speculative decoding partner
 *   [--cache-size=N] [--cache-bytes=4G]
 *   [--no-warmup]
 *
 * Multi-turn chat. The mlx_lm.server keeps a prompt cache so follow-up turns
 * skip prefill (~2–5× lower latency on turn 2+). With `--draft`, a small model
 * proposes tokens for the main one to verify in parallel (~1.5–2× faster output).
 *
 * Exit with Escape or `/exit`. The server is cached across chat sessions for
 * the same model+draft combo.
 */
let cachedClient: MluxeClient | null = null;
let cachedClientKey: string | null = null;

/** Called from process exit handlers — best-effort shutdown of the cached mlx server. */
export function shutdownMlClients(): void {
  if (!cachedClient) return;
  void cachedClient.stopServer();
  cachedClient = null;
  cachedClientKey = null;
}

export async function mlChat(ctx: CommandContext): Promise<void> {
  const { prompt: opening, model, draftModel, cacheSize, cacheBytes, warmup } = parseFlags(ctx.args);

  const ready = await ensureModelDownloaded(ctx, model);
  if (!ready) return;
  if (draftModel) {
    const draftReady = await ensureModelDownloaded(ctx, draftModel);
    if (!draftReady) return;
  }

  const cacheKey = `${model}|${draftModel ?? ''}|${cacheSize}|${cacheBytes ?? ''}`;
  if (!cachedClient || cachedClientKey !== cacheKey) {
    if (cachedClient) await cachedClient.stopServer();
    cachedClient = new MluxeClient({
      model,
      draftModel,
      numDraftTokens: 4,
      promptCacheSize: cacheSize,
      promptCacheBytes: cacheBytes,
      warmup,
      onLog: (line, stream) => {
        if (/^\d{4}-\d{2}-\d{2}.*- INFO -/.test(line)) return;
        if (/^\d{4}-\d{2}-\d{2}.*- DEBUG -/.test(line)) return;
        if (/^127\.0\.0\.1.*"(GET|POST)/.test(line)) return;
        if (/^Fetching \d+ files/.test(line)) return;
        const color = stream === 'stderr' ? 'red-fg' : 'gray-fg';
        ctx.log(`{${color}}[mlx] ${line}{/${color}}`);
      },
    });
    cachedClientKey = cacheKey;
    const knobs: string[] = [`model=${model}`];
    if (draftModel) knobs.push(`draft=${draftModel}`);
    if (cacheSize) knobs.push(`cache=${cacheSize}`);
    if (cacheBytes) knobs.push(`cache-bytes=${cacheBytes}`);
    if (warmup) knobs.push('warmup');
    ctx.log(`{gray-fg}Starting mlx_lm.server (${knobs.join(' · ')})…{/gray-fg}`);
    ctx.progress(` {cyan-fg}⟳{/cyan-fg} {bold}Booting MLX server…{/bold} {gray-fg}(30–60s on first launch; warmup adds a few s){/gray-fg}`);
    try {
      await cachedClient.startServer(240_000);
    } finally {
      ctx.progress(null);
    }
    ctx.log(`{green-fg}✓ server ready at ${cachedClient.baseUrl}{/green-fg}`);
  }

  const client = cachedClient;
  const messages: ChatMessage[] = [];

  ctx.log('');
  ctx.log(`{bold}─── chat with ${model}${draftModel ? ` (+draft ${draftModel})` : ''} ───{/bold}`);
  ctx.log('{gray-fg}Type a message and press Enter. Escape or "/exit" leaves the chat.{/gray-fg}');
  ctx.log('');

  let firstTurn = opening || null;

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
    let firstTokenAt = 0;
    const t0 = Date.now();
    ctx.progress(` {cyan-fg}…{/cyan-fg} {bold}thinking…{/bold}`);
    // Header for the assistant turn — pushed once, stays put.
    ctx.log(`{cyan-fg}mlx ›{/cyan-fg}`);
    // Body grows in place via a live region; blessed handles soft-wrap.
    const region = ctx.streamLines();
    try {
      for await (const chunk of client.chatStream(messages)) {
        if (chunk.done) break;
        if (!firstTokenAt && chunk.delta) {
          firstTokenAt = Date.now();
          ctx.progress(null);
        }
        assistantText += chunk.delta;
        const indented = assistantText.split('\n').map((l) => `  ${l}`).join('\n');
        region.write(indented);
      }
      region.finalize();
    } catch (err) {
      region.finalize();
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
      ctx.log(`{gray-fg}  Hint: /exit and re-enter /ml chat — the client will respawn.{/gray-fg}`);
      messages.pop();
      if (!diag.isRunning && cachedClient === client) {
        cachedClient = null;
        cachedClientKey = null;
      }
      if (!diag.isRunning) return;
      continue;
    }
    ctx.progress(null);

    const totalMs = Date.now() - t0;
    const ttftMs = firstTokenAt ? firstTokenAt - t0 : 0;
    messages.push({ role: 'assistant', content: assistantText });
    // Body already lives in the log via the streamLines region. Just append
    // the timing footer below it.
    ctx.log(`{gray-fg}  (ttft ${ttftMs} ms · total ${totalMs} ms){/gray-fg}`);
    ctx.log('');
  }
}

interface ParsedFlags {
  prompt: string;
  model: string;
  maxTokens: number;
  format: 'text' | 'json';
  draftModel: string | undefined;
  cacheSize: number;
  cacheBytes: string | undefined;
  warmup: boolean;
}

function parseFlags(args: string[]): ParsedFlags {
  let model = DEFAULT_MODEL;
  let maxTokens = 512;
  let format: 'text' | 'json' = 'text';
  let draftModel: string | undefined = DEFAULT_DRAFT_MODEL;
  let cacheSize = 4;
  let cacheBytes: string | undefined;
  let warmup = true;
  const positional: string[] = [];

  for (const a of args) {
    if (a.startsWith('--model=')) model = resolveModelAlias(a.slice(8));
    else if (a.startsWith('--max-tokens=')) maxTokens = Number(a.slice(13)) || maxTokens;
    else if (a.startsWith('--format=')) {
      const f = a.slice(9);
      if (f === 'json' || f === 'text') format = f;
    } else if (a.startsWith('--draft=')) draftModel = resolveModelAlias(a.slice(8));
    else if (a === '--no-draft') draftModel = undefined;
    else if (a.startsWith('--cache-size=')) cacheSize = Number(a.slice(13)) || cacheSize;
    else if (a.startsWith('--cache-bytes=')) cacheBytes = a.slice(14);
    else if (a === '--no-warmup') warmup = false;
    else if (a === '--warmup') warmup = true;
    else positional.push(a);
  }
  return { prompt: positional.join(' '), model, maxTokens, format, draftModel, cacheSize, cacheBytes, warmup };
}
