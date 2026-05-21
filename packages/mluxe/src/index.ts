import { spawn, type ChildProcess } from 'node:child_process';

export interface MluxeConfig {
  /** HuggingFace model ID, e.g. 'mlx-community/Qwen2.5-14B-Instruct-4bit' */
  model: string;
  /** Port for mlx_lm.server (default: 8080) */
  port?: number;
  /** Host to bind (default: '127.0.0.1') */
  host?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class MluxeClient {
  private config: Required<MluxeConfig>;
  private serverProcess: ChildProcess | null = null;

  constructor(config: MluxeConfig) {
    this.config = {
      model: config.model,
      port: config.port ?? 8080,
      host: config.host ?? '127.0.0.1',
    };
  }

  get baseUrl(): string {
    return `http://${this.config.host}:${this.config.port}`;
  }

  /** Start the mlx_lm.server process */
  async startServer(): Promise<void> {
    if (this.serverProcess) {
      throw new Error('Server already running');
    }

    this.serverProcess = spawn('python', [
      '-m', 'mlx_lm.server',
      '--model', this.config.model,
      '--port', String(this.config.port),
      '--host', this.config.host,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Wait for server to be ready
    await this.waitForReady();
  }

  /** Stop the server process */
  async stopServer(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
    }
  }

  /** Send a chat completion request */
  async chat(messages: ChatMessage[], options?: {
    temperature?: number;
    max_tokens?: number;
  }): Promise<ChatResponse> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.max_tokens ?? 2048,
      }),
    });

    if (!response.ok) {
      throw new Error(`MLX server error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>;
      model: string;
      usage?: ChatResponse['usage'];
    };

    return {
      content: data.choices[0]?.message?.content ?? '',
      model: data.model,
      usage: data.usage,
    };
  }

  /** Check if the server is healthy */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async waitForReady(timeoutMs = 30_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isHealthy()) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`MLX server failed to start within ${timeoutMs}ms`);
  }
}
