export interface MluxeConfig {
  /** HuggingFace model ID, e.g. 'mlx-community/Qwen2.5-14B-Instruct-4bit' */
  model: string;
  /** Port for mlx_lm.server (default: 8080) */
  port?: number;
  /** Host to bind (default: '127.0.0.1') */
  host?: string;
  /** Python executable (default: 'python') */
  python?: string;
  /** Called with each line of server stdout/stderr while running */
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
  /**
   * Number of prompt-cache slots in mlx_lm.server. Each slot keeps the KV cache
   * for one conversation so follow-up turns skip prefill. Default 4. Set 0 to
   * disable. Multi-turn chats see roughly 2–5× lower latency on turn 2+.
   */
  promptCacheSize?: number;
  /**
   * Optional cap on total prompt-cache RAM (e.g. '4G', '2048MB'). Forwarded as
   * `--prompt-cache-bytes`. If unset, mlx_lm decides.
   */
  promptCacheBytes?: string;
  /**
   * HF repo id of a small "draft" model for speculative decoding. The draft
   * proposes tokens that the main model verifies in parallel — ~1.5–2× output
   * throughput with no quality loss. Example: `mlx-community/Qwen2.5-0.5B-Instruct-4bit`.
   */
  draftModel?: string;
  /** Tokens the draft proposes per step (default 4). */
  numDraftTokens?: number;
  /**
   * Send a tiny `max_tokens:1` chat after startup so the first real turn doesn't
   * include graph-compile latency. Default false; mluxe consumers (apps/cli) opt in.
   */
  warmup?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: Usage;
}

export interface ChatStreamChunk {
  /** Incremental content delta */
  delta: string;
  /** True on the final chunk */
  done: boolean;
}

export interface ModelInfo {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}
