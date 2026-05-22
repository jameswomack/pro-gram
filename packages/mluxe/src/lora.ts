import { spawn } from 'node:child_process';

export interface LoraTrainOptions {
  /** Base HuggingFace model ID */
  model: string;
  /** Path to training data (JSONL with prompt/completion or messages) */
  data: string;
  /** Output directory for adapter weights */
  adapterPath: string;
  /** Number of training iterations (default: 600) */
  iters?: number;
  /** Batch size (default: 4) */
  batchSize?: number;
  /** Learning rate (default: 1e-5) */
  learningRate?: number;
  /** Rank of LoRA matrices (default: 8) */
  loraRank?: number;
  /** Python executable */
  python?: string;
  /** Streaming log callback */
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
  signal?: AbortSignal;
}

export interface FuseOptions {
  /** Base model the adapter was trained against */
  model: string;
  /** Path to trained adapter weights */
  adapterPath: string;
  /** Output path for fused model */
  savePath: string;
  /** Upload fused model to this HuggingFace repo (optional) */
  hfRepo?: string;
  python?: string;
  onLog?: (line: string, stream: 'stdout' | 'stderr') => void;
  signal?: AbortSignal;
}

/** Train a LoRA adapter via `mlx_lm.lora`. Resolves when training exits cleanly. */
export function trainLora(opts: LoraTrainOptions): Promise<void> {
  const args = [
    '-m', 'mlx_lm.lora',
    '--model', opts.model,
    '--train',
    '--data', opts.data,
    '--adapter-path', opts.adapterPath,
    '--iters', String(opts.iters ?? 600),
    '--batch-size', String(opts.batchSize ?? 4),
    '--learning-rate', String(opts.learningRate ?? 1e-5),
    '--lora-layers', String(opts.loraRank ?? 8),
  ];
  return runPython(opts.python ?? 'python', args, opts.onLog, opts.signal, 'mlx_lm.lora');
}

/** Fuse a LoRA adapter into a base model via `mlx_lm.fuse`. */
export function fuseLora(opts: FuseOptions): Promise<void> {
  const args = [
    '-m', 'mlx_lm.fuse',
    '--model', opts.model,
    '--adapter-path', opts.adapterPath,
    '--save-path', opts.savePath,
    ...(opts.hfRepo ? ['--upload-repo', opts.hfRepo] : []),
  ];
  return runPython(opts.python ?? 'python', args, opts.onLog, opts.signal, 'mlx_lm.fuse');
}

function runPython(
  python: string,
  args: string[],
  onLog: ((l: string, s: 'stdout' | 'stderr') => void) | undefined,
  signal: AbortSignal | undefined,
  label: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const emit = (buf: Buffer, stream: 'stdout' | 'stderr'): void => {
      if (!onLog) return;
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (line) onLog(line, stream);
      }
    };
    proc.stdout.on('data', (b: Buffer) => emit(b, 'stdout'));
    proc.stderr.on('data', (b: Buffer) => emit(b, 'stderr'));

    const onAbort = (): void => { proc.kill('SIGTERM'); };
    signal?.addEventListener('abort', onAbort, { once: true });

    proc.once('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    proc.once('exit', (code, sig) => {
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) return reject(new Error(`${label} aborted`));
      if (code === 0) return resolve();
      reject(new Error(`${label} exited code=${code} signal=${sig}`));
    });
  });
}
