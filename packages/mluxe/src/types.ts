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
