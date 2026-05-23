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
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present when the assistant emitted tool calls. */
  tool_calls?: ToolCall[];
  /** Required when role === 'tool': the id of the call this is responding to. */
  tool_call_id?: string;
  /** Optional name (tool messages) — some servers want it. */
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON-encoded arguments. */
    arguments: string;
  };
}

/**
 * OpenAI function-tool definition. The exact shape `mlx_lm.server` expects in
 * its chat completions endpoint when `tools: [...]` is provided.
 */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface GenerationOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stop?: string[];
  /** Tools available for this turn. Forwarded as OpenAI `tools`. */
  tools?: ToolDefinition[];
  /** Optional `tool_choice` to force a particular tool. */
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
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
  /** Present when the assistant invoked tools instead of (or alongside) replying. */
  tool_calls?: ToolCall[];
  finishReason?: string;
}

export interface ChatStreamChunk {
  /** Incremental content delta */
  delta: string;
  /**
   * Incremental tool-call delta if present. Caller is responsible for
   * accumulating across chunks — each chunk may carry the id, the function
   * name, or a fragment of `arguments`. Use the `index` field to associate
   * fragments with a specific call when multiple are emitted in parallel.
   */
  toolCallDelta?: ToolCallDelta;
  /** True on the final chunk */
  done: boolean;
  /** OpenAI `finish_reason` if surfaced (`stop`, `tool_calls`, `length`, etc.). */
  finishReason?: string;
}

export interface ToolCallDelta {
  /** Index in the assistant's tool_calls array. Required for assembly. */
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface ModelInfo {
  id: string;
  object: string;
  created?: number;
  owned_by?: string;
}
