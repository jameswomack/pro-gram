import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * HuggingFace cache helpers — detect whether a model is already on disk,
 * query its expected size, and download it via a Python child process.
 *
 * The HF cache layout we rely on:
 *
 *   ~/.cache/huggingface/hub/models--<org>--<name>/
 *     blobs/<sha256>            ← raw bytes (one per LFS file)
 *     snapshots/<rev>/<path>    ← symlinks back into blobs/
 *     refs/main                 ← committed revision hash
 *
 * A model is "complete" iff `refs/main` exists and no `*.incomplete` files
 * remain in `blobs/`.
 */

export function modelCacheDir(repo: string): string {
  return path.join(os.homedir(), '.cache', 'huggingface', 'hub', 'models--' + repo.replace(/\//g, '--'));
}

export async function isCachedComplete(repo: string): Promise<boolean> {
  const dir = modelCacheDir(repo);
  try {
    await fs.access(path.join(dir, 'refs', 'main'));
  } catch {
    return false;
  }
  try {
    const blobs = path.join(dir, 'blobs');
    const entries = await fs.readdir(blobs);
    if (entries.some((e) => e.endsWith('.incomplete'))) return false;
  } catch {
    // No blobs dir yet → not complete
    return false;
  }
  return true;
}

/** Recursively sum file sizes under a directory. Missing dir → 0. */
export async function dirSizeBytes(p: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(p, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(p, e.name);
    if (e.isDirectory()) {
      total += await dirSizeBytes(full);
    } else if (e.isFile()) {
      try {
        total += (await fs.stat(full)).size;
      } catch {
        /* ignore */
      }
    }
    // Symlinks: skip — HF cache symlinks point back into blobs/ which we already count.
  }
  return total;
}

interface HfTreeEntry {
  type: 'file' | 'directory';
  path: string;
  size?: number;
}

/** Sum the bytes of every file in the repo's main revision via the HF tree API. */
export async function fetchModelSize(repo: string): Promise<number> {
  const url = `https://huggingface.co/api/models/${repo}/tree/main?recursive=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HF API ${res.status} ${res.statusText}`);
  const items = (await res.json()) as HfTreeEntry[];
  return items
    .filter((i) => i.type === 'file')
    .reduce((sum, i) => sum + (i.size ?? 0), 0);
}

export interface DownloadHandle {
  proc: ChildProcess;
  done: Promise<void>;
  abort: () => void;
}

/**
 * Trigger a snapshot download via `huggingface_hub.snapshot_download`.
 * stdout/stderr is captured so callers can render the last line on failure.
 */
export function downloadModel(repo: string, python = 'python'): DownloadHandle {
  // Pass repo via stdin to avoid quoting nightmares.
  const script = `
import sys
from huggingface_hub import snapshot_download
repo = sys.stdin.read().strip()
snapshot_download(repo)
`;
  const proc = spawn(python, ['-c', script], { stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stdin.end(repo + '\n');

  let stderr = '';
  proc.stderr.on('data', (b: Buffer) => {
    stderr += b.toString('utf8');
    if (stderr.length > 4000) stderr = stderr.slice(-4000);
  });

  const done = new Promise<void>((resolve, reject) => {
    proc.once('error', reject);
    proc.once('exit', (code) => {
      if (code === 0) return resolve();
      const tail = stderr.trim().split('\n').slice(-3).join(' | ');
      reject(new Error(`snapshot_download exit ${code}${tail ? ` — ${tail}` : ''}`));
    });
  });
  return { proc, done, abort: () => proc.kill('SIGTERM') };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
