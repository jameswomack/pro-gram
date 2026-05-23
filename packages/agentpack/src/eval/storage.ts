import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import type { ChatMessage } from '@jameswomack/mluxe';
import type { AssertionResult } from './assertions.js';

export type Tier = 'unit' | 'property' | 'task';

export interface CaseResult {
  tier: Tier;
  caseId: string;
  /** 0–1 score: tier1 = pass rate of assertions; tier2/3 = judge score. */
  score: number;
  /** True if the case meets its threshold (tier1 always 1.0). */
  pass: boolean;
  durationMs: number;
  trajectory: ChatMessage[];
  /** Only populated for tier 1. */
  assertions?: AssertionResult[];
  /** Only populated for tier 2/3. */
  judge?: { reasoning: string; passes: string[]; fails: string[]; threshold: number };
  /** If the run errored before scoring, this is set. */
  error?: string;
}

export interface RunRecord {
  /** ISO timestamp at start. */
  startedAt: string;
  durationMs: number;
  pack: string;
  modelId: string;
  judgeModelId?: string;
  tiersRun: Tier[];
  /** Tier → {n, passed, mean}. */
  summary: Record<Tier, { n: number; passed: number; mean: number } | undefined>;
  cases: CaseResult[];
}

const EVAL_DIR_NAME = '.eval-runs';

export function evalDirFor(packDir: string): string {
  return path.join(packDir, EVAL_DIR_NAME);
}

export async function writeRun(packDir: string, run: RunRecord): Promise<string> {
  const dir = evalDirFor(packDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${run.startedAt.replace(/[:.]/g, '-')}.jsonl`);
  // Header line is the run-level summary; subsequent lines are case results.
  const lines = [
    JSON.stringify({
      __record: 'header',
      startedAt: run.startedAt,
      durationMs: run.durationMs,
      pack: run.pack,
      modelId: run.modelId,
      judgeModelId: run.judgeModelId,
      tiersRun: run.tiersRun,
      summary: run.summary,
    }),
    ...run.cases.map((c) => JSON.stringify({ __record: 'case', ...c })),
  ];
  await writeFile(file, lines.join('\n') + '\n', 'utf-8');
  return file;
}

export async function readRun(file: string): Promise<RunRecord> {
  const raw = await readFile(file, 'utf-8');
  const lines = raw.split('\n').filter(Boolean);
  let header: Partial<RunRecord> | null = null;
  const cases: CaseResult[] = [];
  for (const ln of lines) {
    const parsed = JSON.parse(ln) as { __record: 'header' | 'case' } & Record<string, unknown>;
    if (parsed.__record === 'header') {
      header = parsed as unknown as Partial<RunRecord>;
    } else if (parsed.__record === 'case') {
      const { __record: _r, ...rest } = parsed;
      void _r;
      cases.push(rest as unknown as CaseResult);
    }
  }
  if (!header) throw new Error(`eval-run file ${file} has no header line`);
  return {
    startedAt: header.startedAt ?? '',
    durationMs: header.durationMs ?? 0,
    pack: header.pack ?? '',
    modelId: header.modelId ?? '',
    judgeModelId: header.judgeModelId,
    tiersRun: header.tiersRun ?? [],
    summary: header.summary ?? { unit: undefined, property: undefined, task: undefined },
    cases,
  };
}

/** Most-recent first. */
export async function listRuns(packDir: string): Promise<string[]> {
  const dir = evalDirFor(packDir);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.endsWith('.jsonl'))
    .sort()
    .reverse()
    .map((e) => path.join(dir, e));
}
