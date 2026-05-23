import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandContext } from '@jameswomack/clitermus';
import { MluxeClient } from '@jameswomack/mluxe';
import {
  diffRuns,
  EvalRunner,
  listRuns,
  loadPack,
  McpRegistry,
  readRun,
  writeRun,
  type CaseDelta,
  type CaseResult,
  type RunRecord,
  type Tier,
} from '@jameswomack/agentpack';
import { ensureModelDownloaded } from '../lib/ensure-model.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../');
const PACKS_DIR = path.join(REPO_ROOT, 'packages/packs');

const MODEL_ALIASES: Record<string, string> = {
  'qwen-14b': 'mlx-community/Qwen2.5-14B-Instruct-4bit',
  'qwen-7b': 'mlx-community/Qwen2.5-7B-Instruct-4bit',
  'qwen-3b': 'mlx-community/Qwen2.5-3B-Instruct-4bit',
  'qwen-1.5b': 'mlx-community/Qwen2.5-1.5B-Instruct-4bit',
  'qwen-0.5b': 'mlx-community/Qwen2.5-0.5B-Instruct-4bit',
};

function resolveAlias(id: string): string {
  return MODEL_ALIASES[id.toLowerCase()] ?? id;
}

async function findPackDir(name: string): Promise<string | null> {
  let entries: import('node:fs').Dirent[];
  try { entries = await readdir(PACKS_DIR, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(PACKS_DIR, e.name);
    try {
      const txt = await readFile(path.join(dir, 'pack.toml'), 'utf-8');
      const m = /name\s*=\s*"([^"]+)"/.exec(txt);
      if (m && m[1] === name) return dir;
    } catch { /* skip */ }
  }
  return null;
}

interface EvalFlags {
  packName: string;
  tiers: Tier[];
  diff: boolean;
  judgeModel: string;
}

function parseFlags(args: string[]): EvalFlags | string {
  let packName = '';
  let tiers: Tier[] = ['unit'];
  let diff = false;
  let judgeModel = 'qwen-3b';
  for (const a of args) {
    if (a === '--diff') diff = true;
    else if (a.startsWith('--tier=')) {
      const v = a.slice(7);
      if (v === 'all') tiers = ['unit', 'property', 'task'];
      else if (v === 'unit' || v === 'property' || v === 'task') tiers = [v];
      else if (v === '1') tiers = ['unit'];
      else if (v === '2') tiers = ['property'];
      else if (v === '3') tiers = ['task'];
      else return `unknown --tier value: ${v}`;
    } else if (a.startsWith('--judge-model=')) {
      judgeModel = a.slice(14);
    } else if (!a.startsWith('--') && !packName) {
      packName = a;
    } else {
      return `unknown arg: ${a}`;
    }
  }
  if (!packName) return 'pack name is required';
  return { packName, tiers, diff, judgeModel };
}

let cachedClient: { modelId: string; client: MluxeClient } | null = null;
let cachedJudge: { modelId: string; client: MluxeClient } | null = null;

export function shutdownPackEvalClients(): void {
  if (cachedClient) void cachedClient.client.stopServer();
  if (cachedJudge) void cachedJudge.client.stopServer();
  cachedClient = null;
  cachedJudge = null;
}

async function getOrCreateClient(modelId: string, draftId: string | undefined, ctx: CommandContext): Promise<MluxeClient> {
  if (cachedClient && cachedClient.modelId === modelId) return cachedClient.client;
  if (cachedClient) await cachedClient.client.stopServer();
  const c = new MluxeClient({
    model: modelId,
    draftModel: draftId,
    promptCacheSize: 4,
    warmup: true,
    onLog: (line, stream) => {
      if (/^\d{4}-\d{2}-\d{2}.*- (INFO|DEBUG) -/.test(line)) return;
      if (/^127\.0\.0\.1.*"(GET|POST)/.test(line)) return;
      if (/^Fetching \d+ files/.test(line)) return;
      const color = stream === 'stderr' ? 'red-fg' : 'gray-fg';
      ctx.log(`{${color}}[mlx] ${line}{/${color}}`);
    },
  });
  ctx.progress(` {cyan-fg}⟳{/cyan-fg} {bold}Booting MLX server for ${modelId}…{/bold}`);
  try { await c.startServer(240_000); } finally { ctx.progress(null); }
  ctx.log(`{green-fg}✓ pack model server ready at ${c.baseUrl}{/green-fg}`);
  cachedClient = { modelId, client: c };
  return c;
}

async function getOrCreateJudge(modelId: string, ctx: CommandContext): Promise<MluxeClient> {
  if (cachedJudge && cachedJudge.modelId === modelId) return cachedJudge.client;
  if (cachedJudge) await cachedJudge.client.stopServer();
  // Pin to a different port so the pack-model server stays up.
  const c = new MluxeClient({
    model: modelId,
    port: 8090,
    promptCacheSize: 1,
    warmup: false,
    onLog: (line, stream) => {
      if (/^\d{4}-\d{2}-\d{2}.*- (INFO|DEBUG) -/.test(line)) return;
      if (/^127\.0\.0\.1.*"(GET|POST)/.test(line)) return;
      if (/^Fetching \d+ files/.test(line)) return;
      const color = stream === 'stderr' ? 'red-fg' : 'gray-fg';
      ctx.log(`{${color}}[judge] ${line}{/${color}}`);
    },
  });
  ctx.progress(` {cyan-fg}⟳{/cyan-fg} {bold}Booting judge model ${modelId}…{/bold}`);
  try { await c.startServer(240_000); } finally { ctx.progress(null); }
  ctx.log(`{green-fg}✓ judge ready at ${c.baseUrl}{/green-fg}`);
  cachedJudge = { modelId, client: c };
  return c;
}

function fmtScore(n: number): string {
  return n.toFixed(2);
}

function statusGlyph(pass: boolean): string {
  return pass ? '{green-fg}✓{/green-fg}' : '{red-fg}✗{/red-fg}';
}

function renderCase(ctx: CommandContext, r: CaseResult): void {
  const head = `  ${statusGlyph(r.pass)} ${r.caseId.padEnd(40)}  ${fmtScore(r.score)}  {gray-fg}${r.durationMs} ms${r.tier !== 'unit' ? ` · judge` : ''}{/gray-fg}`;
  ctx.log(head);
  if (r.error) ctx.log(`    {red-fg}error: ${r.error}{/red-fg}`);
  if (r.assertions) {
    for (const a of r.assertions) {
      if (!a.pass) ctx.log(`    {red-fg}↳ FAIL{/red-fg} ${a.message}`);
    }
  }
  if (r.judge && !r.pass) {
    if (r.judge.fails.length > 0) ctx.log(`    {red-fg}↳ fails:{/red-fg} ${r.judge.fails.join('; ')}`);
    if (r.judge.reasoning) ctx.log(`    {gray-fg}↳ ${r.judge.reasoning}{/gray-fg}`);
  }
}

export async function packEval(ctx: CommandContext): Promise<void> {
  const parsed = parseFlags(ctx.args);
  if (typeof parsed === 'string') {
    ctx.log(`{red-fg}/pack eval: ${parsed}{/red-fg}`);
    ctx.log('{gray-fg}Usage: /pack eval <name> [--tier=1|2|3|all] [--diff] [--judge-model=qwen-3b]{/gray-fg}');
    return;
  }
  const dir = await findPackDir(parsed.packName);
  if (!dir) { ctx.log(`{red-fg}No such pack: ${parsed.packName}{/red-fg}`); return; }
  const loaded = await loadPack(dir);
  const modelId = resolveAlias(loaded.model.id);
  const draftId = loaded.model.draft ? resolveAlias(loaded.model.draft) : undefined;
  const judgeId = resolveAlias(parsed.judgeModel);
  const needsJudge = parsed.tiers.some((t) => t !== 'unit');

  ctx.log(`{bold}Evaluating pack "${loaded.manifest.pack.name}"{/bold}  tiers=${parsed.tiers.join(',')}  model=${modelId}${needsJudge ? `  judge=${judgeId}` : ''}`);

  const modelReady = await ensureModelDownloaded(ctx, modelId);
  if (!modelReady) return;
  if (draftId) {
    const d = await ensureModelDownloaded(ctx, draftId);
    if (!d) return;
  }
  if (needsJudge) {
    const j = await ensureModelDownloaded(ctx, judgeId);
    if (!j) return;
  }

  const packClient = await getOrCreateClient(modelId, draftId, ctx);
  const judge = needsJudge ? await getOrCreateJudge(judgeId, ctx) : undefined;

  const mcp = await McpRegistry.fromConfigs(loaded.dir, loaded.manifest.mcp);
  try {
    const runner = new EvalRunner(loaded, mcp, packClient);
    const run = await runner.run({
      tiers: parsed.tiers,
      judge,
      judgeModelId: needsJudge ? judgeId : undefined,
      hooks: {
        onTierStart: (tier, total) => {
          ctx.log('');
          ctx.log(`{bold}── tier: ${tier} (${total}) ──{/bold}`);
        },
        onCaseStart: ({ caseId, index, total }) => {
          ctx.progress(` {cyan-fg}⟳{/cyan-fg} ${caseId} {gray-fg}(${index + 1}/${total}){/gray-fg}`);
        },
        onCaseEnd: (r: CaseResult) => {
          ctx.progress(null);
          renderCase(ctx, r);
        },
        onTierEnd: (_tier: Tier, s: { passed: number; n: number; mean: number }) => {
          ctx.log(`  {gray-fg}summary: ${s.passed}/${s.n} passed · mean ${fmtScore(s.mean)}{/gray-fg}`);
        },
      },
    });

    ctx.log('');
    ctx.log(`{bold}done in ${run.durationMs} ms{/bold}`);
    const file = await writeRun(loaded.dir, run);
    ctx.log(`{gray-fg}wrote ${path.relative(REPO_ROOT, file)}{/gray-fg}`);

    if (parsed.diff) {
      const prior = (await listRuns(loaded.dir)).filter((f: string) => f !== file);
      if (prior.length === 0) {
        ctx.log('{gray-fg}--diff: no prior run to compare against.{/gray-fg}');
      } else {
        const prev = await readRun(prior[0]!);
        renderDiff(ctx, prev, run);
      }
    }
  } finally {
    await mcp.close();
  }
}

function renderDiff(ctx: CommandContext, prev: RunRecord, curr: RunRecord): void {
  const d = diffRuns(prev, curr);
  ctx.log('');
  ctx.log(`{bold}── diff vs ${path.basename(prev.startedAt)} ──{/bold}`);
  for (const tier of ['unit', 'property', 'task'] as const) {
    const s = d.summary[tier];
    if (!s) continue;
    const dMean = s.currMean - s.prevMean;
    const arrow = dMean > 0.01 ? '↑' : dMean < -0.01 ? '↓' : '→';
    const color = dMean > 0.01 ? 'green-fg' : dMean < -0.01 ? 'red-fg' : 'gray-fg';
    ctx.log(`  ${tier}: ${s.prevPassed}/${s.n} → ${s.currPassed}/${s.n}  mean ${fmtScore(s.prevMean)} {${color}}${arrow}{/${color}} ${fmtScore(s.currMean)}`);
  }
  ctx.log('');
  const interesting = d.deltas.filter((dx: CaseDelta) => dx.status !== 'unchanged');
  if (interesting.length === 0) {
    ctx.log('{gray-fg}no per-case changes.{/gray-fg}');
    return;
  }
  const TAGS: Record<CaseDelta['status'], string> = {
    improved: '{green-fg}↑ improved{/green-fg}',
    regressed: '{red-fg}↓ regressed{/red-fg}',
    new: '{cyan-fg}+ new{/cyan-fg}',
    removed: '{gray-fg}- removed{/gray-fg}',
    unchanged: '',
  };
  for (const dx of interesting) {
    const tag = TAGS[dx.status];
    const prevStr = dx.prevScore !== undefined ? fmtScore(dx.prevScore) : '—';
    ctx.log(`  ${tag}  ${dx.caseId}  ${prevStr} → ${fmtScore(dx.currScore)}`);
  }
}

export const packEvalCommand = {
  name: 'pack eval',
  description: 'Run a pack\'s eval suite. Usage: /pack eval <name> [--tier=1|2|3|all] [--diff] [--judge-model=qwen-3b]',
  handler: packEval,
};
