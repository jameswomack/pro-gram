import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import yaml from 'js-yaml';
import type { ChatMessage, MluxeClient } from '@jameswomack/mluxe';
import { McpRegistry } from '../mcp.js';
import { PackRuntime } from '../runtime.js';
import type { LoadedPack } from '../pack.js';
import { evaluateAssertion, type AssertionResult } from './assertions.js';
import { runJudge } from './judge.js';
import {
  PropertyFileSchema,
  TaskFileSchema,
  UnitCaseFileSchema,
  type PropertyCase,
  type TaskCase,
  type UnitCase,
} from './schema.js';
import type { CaseResult, RunRecord, Tier } from './storage.js';

export interface EvalOptions {
  tiers: Tier[];
  /** Optional judge client. Required if `property` or `task` is in tiers. */
  judge?: MluxeClient;
  judgeModelId?: string;
  /** Per-case hooks for live UI rendering. */
  hooks?: EvalHooks;
}

export interface EvalHooks {
  onCaseStart?: (info: { tier: Tier; caseId: string; total: number; index: number }) => void;
  onCaseEnd?: (result: CaseResult) => void;
  onTierStart?: (tier: Tier, total: number) => void;
  onTierEnd?: (tier: Tier, summary: { passed: number; n: number; mean: number }) => void;
}

interface LoadedSuite {
  unit: UnitCase[];
  property: PropertyCase[];
  task: TaskCase[];
}

async function loadSuite(packDir: string): Promise<LoadedSuite> {
  return {
    unit: await loadYaml(path.join(packDir, 'evals', 'cases.yaml'), UnitCaseFileSchema, (f) => f.cases),
    property: await loadYaml(path.join(packDir, 'evals', 'properties.yaml'), PropertyFileSchema, (f) => f.properties),
    task: await loadYaml(path.join(packDir, 'evals', 'tasks.yaml'), TaskFileSchema, (f) => f.tasks),
  };
}

async function loadYaml<S extends { parse: (input: unknown) => unknown }, T>(
  file: string,
  schema: S,
  pick: (parsed: ReturnType<S['parse']>) => T,
): Promise<T> {
  try {
    const raw = await readFile(file, 'utf-8');
    return pick(schema.parse(yaml.load(raw)) as ReturnType<S['parse']>);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return pick(schema.parse({}) as ReturnType<S['parse']>);
    }
    throw err;
  }
}

/**
 * Drive a single non-interactive case through a fresh `PackRuntime`. We queue
 * up the case's user messages in order and resolve `null` once exhausted so
 * the runtime returns. The trajectory recorder collects every message via the
 * `onMessage` hook.
 */
async function runScripted(
  pack: LoadedPack,
  mcp: McpRegistry,
  client: MluxeClient,
  userTurns: string[],
  perCaseMaxTokens: number,
): Promise<{ trajectory: ChatMessage[]; durationMs: number; error?: string }> {
  const queue = [...userTurns];
  const trajectory: ChatMessage[] = [];
  // Temporarily override the pack's maxTokens for this case so tier 1 cases stay cheap.
  const scoped: LoadedPack = { ...pack, model: { ...pack.model, maxTokens: perCaseMaxTokens } };
  const runtime = new PackRuntime(scoped, mcp, client);
  let error: string | undefined;
  const start = Date.now();
  await runtime.run(
    {
      nextUserMessage: async () => queue.shift() ?? null,
      onMessage: (m) => trajectory.push(m),
      onError: (e) => { error = e.message; },
    },
  );
  return { trajectory, durationMs: Date.now() - start, error };
}

export class EvalRunner {
  constructor(
    private pack: LoadedPack,
    private mcp: McpRegistry,
    private client: MluxeClient,
  ) {}

  /**
   * Execute the requested tiers and return a `RunRecord` (not yet persisted).
   * `EvalRunner` does not own storage — callers pass the result to `writeRun`.
   */
  async run(opts: EvalOptions): Promise<RunRecord> {
    const suite = await loadSuite(this.pack.dir);
    const startedAt = new Date().toISOString();
    const start = Date.now();
    const results: CaseResult[] = [];

    if (opts.tiers.includes('unit')) {
      const tierStart = suite.unit;
      opts.hooks?.onTierStart?.('unit', tierStart.length);
      for (let i = 0; i < tierStart.length; i++) {
        const c = tierStart[i]!;
        opts.hooks?.onCaseStart?.({ tier: 'unit', caseId: c.id, total: tierStart.length, index: i });
        const result = await this.runUnitCase(c);
        results.push(result);
        opts.hooks?.onCaseEnd?.(result);
      }
      const tierResults = results.filter((r) => r.tier === 'unit');
      opts.hooks?.onTierEnd?.('unit', {
        passed: tierResults.filter((r) => r.pass).length,
        n: tierResults.length,
        mean: meanScore(tierResults),
      });
    }

    if (opts.tiers.includes('property')) {
      if (!opts.judge) throw new Error('property tier requires a judge MluxeClient');
      opts.hooks?.onTierStart?.('property', suite.property.length);
      for (let i = 0; i < suite.property.length; i++) {
        const c = suite.property[i]!;
        opts.hooks?.onCaseStart?.({ tier: 'property', caseId: c.id, total: suite.property.length, index: i });
        const result = await this.runPropertyCase(c, opts.judge);
        results.push(result);
        opts.hooks?.onCaseEnd?.(result);
      }
      const tierResults = results.filter((r) => r.tier === 'property');
      opts.hooks?.onTierEnd?.('property', {
        passed: tierResults.filter((r) => r.pass).length,
        n: tierResults.length,
        mean: meanScore(tierResults),
      });
    }

    if (opts.tiers.includes('task')) {
      if (!opts.judge) throw new Error('task tier requires a judge MluxeClient');
      opts.hooks?.onTierStart?.('task', suite.task.length);
      for (let i = 0; i < suite.task.length; i++) {
        const c = suite.task[i]!;
        opts.hooks?.onCaseStart?.({ tier: 'task', caseId: c.id, total: suite.task.length, index: i });
        const result = await this.runTaskCase(c, opts.judge);
        results.push(result);
        opts.hooks?.onCaseEnd?.(result);
      }
      const tierResults = results.filter((r) => r.tier === 'task');
      opts.hooks?.onTierEnd?.('task', {
        passed: tierResults.filter((r) => r.pass).length,
        n: tierResults.length,
        mean: meanScore(tierResults),
      });
    }

    return {
      startedAt,
      durationMs: Date.now() - start,
      pack: this.pack.manifest.pack.name,
      modelId: this.pack.model.id,
      judgeModelId: opts.judgeModelId,
      tiersRun: opts.tiers,
      summary: {
        unit: summarize(results, 'unit'),
        property: summarize(results, 'property'),
        task: summarize(results, 'task'),
      },
      cases: results,
    };
  }

  private async runUnitCase(c: UnitCase): Promise<CaseResult> {
    const start = Date.now();
    const { trajectory, error } = await runScripted(this.pack, this.mcp, this.client, [c.input], c.maxTokens);
    if (error) {
      return baseResult('unit', c.id, 0, false, Date.now() - start, trajectory, error);
    }
    const assertions: AssertionResult[] = c.asserts.map((a) => evaluateAssertion(a, trajectory));
    const score = assertions.length === 0 ? 1 : assertions.filter((r) => r.pass).length / assertions.length;
    const pass = assertions.every((r) => r.pass);
    return { ...baseResult('unit', c.id, score, pass, Date.now() - start, trajectory), assertions };
  }

  private async runPropertyCase(c: PropertyCase, judge: MluxeClient): Promise<CaseResult> {
    const start = Date.now();
    const { trajectory, error } = await runScripted(this.pack, this.mcp, this.client, [c.input], c.maxTokens);
    if (error) {
      return baseResult('property', c.id, 0, false, Date.now() - start, trajectory, error);
    }
    const j = await runJudge(c.rubric, c.input, trajectory, { judge });
    const pass = j.score >= c.threshold;
    return {
      ...baseResult('property', c.id, j.score, pass, Date.now() - start, trajectory),
      judge: { reasoning: j.reasoning, passes: j.passes, fails: j.fails, threshold: c.threshold },
    };
  }

  private async runTaskCase(c: TaskCase, judge: MluxeClient): Promise<CaseResult> {
    const start = Date.now();
    const turns = c.steps.map((s) => s.user);
    const { trajectory, error } = await runScripted(this.pack, this.mcp, this.client, turns, c.maxTokens);
    if (error) {
      return baseResult('task', c.id, 0, false, Date.now() - start, trajectory, error);
    }
    const userBundle = turns.map((t, i) => `[turn ${i + 1}] ${t}`).join('\n');
    const j = await runJudge(c.rubric, userBundle, trajectory, { judge });
    const pass = j.score >= c.threshold;
    return {
      ...baseResult('task', c.id, j.score, pass, Date.now() - start, trajectory),
      judge: { reasoning: j.reasoning, passes: j.passes, fails: j.fails, threshold: c.threshold },
    };
  }
}

function baseResult(
  tier: Tier,
  caseId: string,
  score: number,
  pass: boolean,
  durationMs: number,
  trajectory: ChatMessage[],
  error?: string,
): CaseResult {
  return { tier, caseId, score, pass, durationMs, trajectory, ...(error ? { error } : {}) };
}

function summarize(cases: CaseResult[], tier: Tier): { n: number; passed: number; mean: number } | undefined {
  const filtered = cases.filter((c) => c.tier === tier);
  if (filtered.length === 0) return undefined;
  return {
    n: filtered.length,
    passed: filtered.filter((c) => c.pass).length,
    mean: meanScore(filtered),
  };
}

function meanScore(cases: CaseResult[]): number {
  if (cases.length === 0) return 0;
  return cases.reduce((s, c) => s + c.score, 0) / cases.length;
}
