import { spawn } from 'node:child_process';
import type { GenerationOptions } from './types.js';

export interface GenerateOptions extends GenerationOptions {
  /** HuggingFace model ID */
  model: string;
  /** Python executable (default: 'python') */
  python?: string;
  /** Abort signal — kills the subprocess */
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  /** Combined stderr — MLX prints stats here */
  stderr: string;
  exitCode: number;
}

/**
 * CLI/batch mode — shells out to `python -m mlx_lm.generate`.
 * No server required; ideal for one-shot generation or scripted batches.
 */
export function generate(prompt: string, options: GenerateOptions): Promise<GenerateResult> {
  const args = [
    '-m', 'mlx_lm.generate',
    '--model', options.model,
    '--prompt', prompt,
    '--max-tokens', String(options.max_tokens ?? 512),
    '--temp', String(options.temperature ?? 0.7),
    '--top-p', String(options.top_p ?? 1.0),
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(options.python ?? 'python', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    proc.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });

    const onAbort = (): void => { proc.kill('SIGTERM'); };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    proc.once('error', (err) => {
      options.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    proc.once('exit', (code) => {
      options.signal?.removeEventListener('abort', onAbort);
      if (options.signal?.aborted) {
        reject(new Error('mluxe generate aborted'));
        return;
      }
      resolve({ text: stripGenerateBanner(stdout), stderr, exitCode: code ?? -1 });
    });
  });
}

/**
 * mlx_lm.generate prefixes output with a banner like:
 *   ==========
 *   <generated text>
 *   ==========
 * Strip that so callers get just the model output.
 */
function stripGenerateBanner(raw: string): string {
  const m = raw.match(/={5,}\s*\n([\s\S]*?)\n={5,}/);
  return (m?.[1] ?? raw).trim();
}
