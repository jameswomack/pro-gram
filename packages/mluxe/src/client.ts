import { spawn, type ChildProcess } from 'node:child_process';
import * as net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  ChatMessage,
  ChatResponse,
  ChatStreamChunk,
  GenerationOptions,
  ModelInfo,
  MluxeConfig,
} from './types.js';

type ResolvedConfig = Required<Omit<MluxeConfig, 'onLog' | 'promptCacheBytes' | 'draftModel'>> &
  Pick<MluxeConfig, 'onLog' | 'promptCacheBytes' | 'draftModel'>;

/** Ask the OS for an unused TCP port on `host`. */
async function findFreePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('Could not obtain free port'));
      }
    });
  });
}

/** True if `port` on `host` is currently bindable. */
async function isPortAvailable(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

interface OpenAIChoice {
  message?: { content?: string };
  delta?: { content?: string };
  finish_reason?: string | null;
}

interface OpenAIResponse {
  model: string;
  choices: OpenAIChoice[];
  usage?: ChatResponse['usage'];
}

export class MluxeClient {
  private readonly config: ResolvedConfig;
  /** Port we actually bound — may differ from config.port if it was taken. */
  private activePort: number;
  private serverProcess: ChildProcess | null = null;
  /** True when we connected to a pre-existing mlx_lm.server instead of spawning. */
  private adoptedExisting = false;
  /** Ring buffer of recent stderr lines (most recent last). Capped at 80. */
  private recentStderr: string[] = [];
  /** Captured details about how the spawned server last exited (or null). */
  private lastExit: { code: number | null; signal: NodeJS.Signals | null } | null = null;

  constructor(config: MluxeConfig) {
    this.config = {
      model: config.model,
      port: config.port ?? 8080,
      host: config.host ?? '127.0.0.1',
      python: config.python ?? 'python',
      onLog: config.onLog,
      promptCacheSize: config.promptCacheSize ?? 4,
      promptCacheBytes: config.promptCacheBytes,
      draftModel: config.draftModel,
      numDraftTokens: config.numDraftTokens ?? 4,
      warmup: config.warmup ?? false,
    };
    this.activePort = this.config.port;
  }

  get baseUrl(): string {
    return `http://${this.config.host}:${this.activePort}`;
  }

  get model(): string {
    return this.config.model;
  }

  get isRunning(): boolean {
    return this.serverProcess !== null;
  }

  /**
   * Start `mlx_lm.server` (or adopt an existing one).
   *
   * Resolution order:
   *   1. If the configured port already serves a compatible mlx_lm.server for
   *      our model, adopt it — don't spawn a duplicate.
   *   2. If the port is free, spawn on it.
   *   3. If the port is taken by something else (or a different model), pick a
   *      free OS-assigned port and spawn there.
   */
  async startServer(timeoutMs = 60_000): Promise<void> {
    if (this.serverProcess) throw new Error('mluxe server already running');
    if (this.adoptedExisting) return;

    // 1) Existing compatible server?
    this.activePort = this.config.port;
    if (await this.probeExistingCompatible()) {
      this.adoptedExisting = true;
      this.config.onLog?.(
        `[mluxe] adopted existing server at ${this.baseUrl} (same model already loaded)`,
        'stdout',
      );
      return;
    }

    // 2 or 3) Decide which port to actually use
    if (!(await isPortAvailable(this.activePort, this.config.host))) {
      const free = await findFreePort(this.config.host);
      this.config.onLog?.(
        `[mluxe] port ${this.activePort} is busy — switching to ${free}`,
        'stderr',
      );
      this.activePort = free;
    }

    const args = [
      '-m', 'mlx_lm.server',
      '--model', this.config.model,
      '--port', String(this.activePort),
      '--host', this.config.host,
    ];
    if (this.config.promptCacheSize > 0) {
      args.push('--prompt-cache-size', String(this.config.promptCacheSize));
    }
    if (this.config.promptCacheBytes) {
      args.push('--prompt-cache-bytes', this.config.promptCacheBytes);
    }
    if (this.config.draftModel) {
      args.push('--draft-model', this.config.draftModel);
      args.push('--num-draft-tokens', String(this.config.numDraftTokens));
    }
    this.config.onLog?.(`[mluxe] spawn args: ${args.slice(1).join(' ')}`, 'stdout');
    const proc = spawn(this.config.python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    this.serverProcess = proc;

    // ALWAYS drain stdout/stderr — if we don't, the OS pipe buffer fills
    // (~64KB on macOS) and the child blocks on write, which looks like the
    // server "freezing" mid-request. Buffer recent lines for diagnostics.
    proc.stdout?.on('data', (b: Buffer) => this.captureLines(b, 'stdout'));
    proc.stderr?.on('data', (b: Buffer) => this.captureLines(b, 'stderr'));

    proc.once('exit', (code, signal) => {
      this.serverProcess = null;
      this.lastExit = { code, signal };
      this.config.onLog?.(`[mluxe] server exited code=${code} signal=${signal}`, 'stderr');
    });

    try {
      await this.waitForReady(timeoutMs);
    } catch (err) {
      await this.stopServer();
      throw err;
    }

    if (this.config.warmup) {
      // Trigger graph compilation + KV-cache allocation with a 1-token request
      // so the user's first real turn doesn't pay that latency.
      try {
        await this.chat([{ role: 'user', content: '.' }], { max_tokens: 1 });
        this.config.onLog?.(`[mluxe] warmup complete`, 'stdout');
      } catch (err) {
        this.config.onLog?.(
          `[mluxe] warmup failed (continuing): ${err instanceof Error ? err.message : String(err)}`,
          'stderr',
        );
      }
    }
  }

  async stopServer(): Promise<void> {
    if (this.adoptedExisting) {
      // We didn't start it — don't kill it.
      this.adoptedExisting = false;
      return;
    }
    const proc = this.serverProcess;
    if (!proc) return;
    this.serverProcess = null;
    proc.kill('SIGTERM');
    const exited = await Promise.race([
      new Promise<boolean>((r) => proc.once('exit', () => r(true))),
      delay(5_000, false),
    ]);
    if (!exited && !proc.killed) proc.kill('SIGKILL');
  }

  /**
   * Hit /v1/models on the configured port. If something there responds with
   * our model loaded, treat it as compatible. Short timeout — we don't want
   * to stall startup when the port is simply free.
   */
  private async probeExistingCompatible(): Promise<boolean> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`${this.baseUrl}/v1/models`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (data.data ?? []).map((d) => d.id ?? '');
      const wanted = this.config.model;
      const wantedLeaf = wanted.split('/').pop() ?? wanted;
      return ids.some((id) => id === wanted || id.endsWith(wantedLeaf));
    } catch {
      return false;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const res = await fetch(`${this.baseUrl}/v1/models`);
    if (!res.ok) throw new Error(`MLX server error: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { data?: ModelInfo[] };
    return data.data ?? [];
  }

  /** One-shot chat completion */
  async chat(messages: ChatMessage[], options?: GenerationOptions): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: false,
        ...this.normalizeOptions(options),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`MLX chat error: ${res.status} ${res.statusText} ${body}`);
    }
    const data = (await res.json()) as OpenAIResponse;
    return {
      content: data.choices[0]?.message?.content ?? '',
      model: data.model,
      usage: data.usage,
    };
  }

  /** Streaming chat — yields incremental deltas */
  async *chatStream(
    messages: ChatMessage[],
    options?: GenerationOptions,
  ): AsyncGenerator<ChatStreamChunk, void, void> {
    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        stream: true,
        ...this.normalizeOptions(options),
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(`MLX chat stream error: ${res.status} ${res.statusText} ${body}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') {
          yield { delta: '', done: true };
          return;
        }
        try {
          const chunk = JSON.parse(payload) as OpenAIResponse;
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) yield { delta, done: false };
        } catch {
          // Skip malformed lines
        }
      }
    }
    yield { delta: '', done: true };
  }

  /** Raw (non-chat) text completion */
  async complete(prompt: string, options?: GenerationOptions): Promise<string> {
    const res = await fetch(`${this.baseUrl}/v1/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        prompt,
        stream: false,
        ...this.normalizeOptions(options),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`MLX completion error: ${res.status} ${res.statusText} ${body}`);
    }
    const data = (await res.json()) as { choices: Array<{ text?: string }> };
    return data.choices[0]?.text ?? '';
  }

  private normalizeOptions(o?: GenerationOptions): Record<string, unknown> {
    return {
      temperature: o?.temperature ?? 0.7,
      top_p: o?.top_p ?? 1.0,
      max_tokens: o?.max_tokens ?? 2048,
      ...(o?.stop ? { stop: o.stop } : {}),
    };
  }

  /**
   * Drain a chunk of stdout/stderr — append to the ring buffer (so diagnostics
   * have recent context) and forward to `onLog` if provided. Critical: this
   * runs regardless of `onLog`, because *not* draining the pipe leads to the
   * child blocking on write once the kernel buffer is full.
   */
  private captureLines(buf: Buffer, stream: 'stdout' | 'stderr'): void {
    for (const line of buf.toString('utf8').split(/\r?\n/)) {
      if (!line) continue;
      this.recentStderr.push(`[${stream}] ${line}`);
      if (this.recentStderr.length > 80) this.recentStderr.splice(0, this.recentStderr.length - 80);
      this.config.onLog?.(line, stream);
    }
  }

  /** Snapshot of recent stderr/stdout (most-recent-last) + exit info. */
  getDiagnostics(): {
    recentOutput: string[];
    lastExit: { code: number | null; signal: NodeJS.Signals | null } | null;
    isRunning: boolean;
  } {
    return {
      recentOutput: this.recentStderr.slice(),
      lastExit: this.lastExit,
      isRunning: this.serverProcess !== null || this.adoptedExisting,
    };
  }

  private async waitForReady(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isHealthy()) return;
      await delay(500);
    }
    throw new Error(`MLX server failed to start within ${timeoutMs}ms`);
  }
}
