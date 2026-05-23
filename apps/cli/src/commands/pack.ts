import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CommandContext, LiveRegion } from '@jameswomack/clitermus';
import { MluxeClient } from '@jameswomack/mluxe';
import { loadPack, McpRegistry, PackRuntime } from '@jameswomack/agentpack';
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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

async function listAvailablePacks(): Promise<{ name: string; dir: string; description: string }[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(PACKS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { name: string; dir: string; description: string }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(PACKS_DIR, e.name);
    try {
      const tomlText = await readFile(path.join(dir, 'pack.toml'), 'utf-8');
      const name = /name\s*=\s*"([^"]+)"/.exec(tomlText)?.[1] ?? e.name;
      const description = /description\s*=\s*"([^"]+)"/.exec(tomlText)?.[1] ?? '';
      out.push({ name, dir, description });
    } catch {
      /* not a pack — skip */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function packList(ctx: CommandContext): Promise<void> {
  const packs = await listAvailablePacks();
  if (packs.length === 0) {
    ctx.log('{gray-fg}No packs found under packages/packs/.{/gray-fg}');
    return;
  }
  ctx.log('{bold}Available packs:{/bold}');
  for (const p of packs) {
    ctx.log(`  {cyan-fg}${p.name}{/cyan-fg}  {gray-fg}${p.description}{/gray-fg}`);
  }
  ctx.log('');
  ctx.log('{gray-fg}Inspect: /pack info <name> · Chat: /pack run <name>{/gray-fg}');
}

export async function packInfo(ctx: CommandContext): Promise<void> {
  const name = ctx.args[0];
  if (!name) {
    ctx.log('{red-fg}Usage: /pack info <name>{/red-fg}');
    return;
  }
  const packs = await listAvailablePacks();
  const target = packs.find((p) => p.name === name);
  if (!target) {
    ctx.log(`{red-fg}No such pack: ${name}{/red-fg}`);
    return;
  }
  const loaded = await loadPack(target.dir);
  ctx.log(`{bold}${loaded.manifest.pack.name}{/bold}  {gray-fg}v${loaded.manifest.pack.version}{/gray-fg}`);
  ctx.log(`  {gray-fg}${loaded.manifest.pack.description}{/gray-fg}`);
  ctx.log(`  model: {cyan-fg}${loaded.model.id}{/cyan-fg}${loaded.model.draft ? ` (+draft ${loaded.model.draft})` : ''}  temp=${loaded.model.temperature ?? 0.7}`);
  ctx.log(`  mcp servers: ${loaded.manifest.mcp.map((m) => m.id).join(', ') || '(none)'}`);
  ctx.log(`  auto skills: ${loaded.manifest.skill.filter((s) => s.auto).map((s) => s.id).join(', ') || '(none)'}`);
  ctx.log(`  on-demand skills: ${loaded.ondemandSkills.map((s) => s.id).join(', ') || '(none)'}`);
  ctx.log('');
  ctx.log('{gray-fg}--- system prompt (composed, first 30 lines) ---{/gray-fg}');
  const lines = loaded.systemPrompt.split('\n');
  for (const line of lines.slice(0, 30)) ctx.log(`  ${line}`);
  if (lines.length > 30) ctx.log('{gray-fg}  (… truncated){/gray-fg}');
}

let cached: { name: string; modelId: string; client: MluxeClient; mcp: McpRegistry } | null = null;

export function shutdownPackClients(): void {
  if (!cached) return;
  void cached.client.stopServer();
  void cached.mcp.close();
  cached = null;
}

export async function packRun(ctx: CommandContext): Promise<void> {
  const name = ctx.args[0];
  if (!name) {
    ctx.log('{red-fg}Usage: /pack run <name>{/red-fg}');
    return;
  }
  const packs = await listAvailablePacks();
  const target = packs.find((p) => p.name === name);
  if (!target) {
    ctx.log(`{red-fg}No such pack: ${name}{/red-fg}`);
    return;
  }

  const loaded = await loadPack(target.dir);
  const modelId = resolveAlias(loaded.model.id);
  const draftId = loaded.model.draft ? resolveAlias(loaded.model.draft) : undefined;

  const modelReady = await ensureModelDownloaded(ctx, modelId);
  if (!modelReady) return;
  if (draftId) {
    const draftReady = await ensureModelDownloaded(ctx, draftId);
    if (!draftReady) return;
  }

  if (!cached || cached.name !== loaded.manifest.pack.name || cached.modelId !== modelId) {
    if (cached) {
      await cached.client.stopServer();
      await cached.mcp.close();
    }
    const client = new MluxeClient({
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
    ctx.log(`{gray-fg}Starting mlx_lm.server for pack "${loaded.manifest.pack.name}" (model=${modelId}${draftId ? ` · draft=${draftId}` : ''})…{/gray-fg}`);
    ctx.progress(' {cyan-fg}⟳{/cyan-fg} {bold}Booting MLX server…{/bold}');
    try {
      await client.startServer(240_000);
    } finally {
      ctx.progress(null);
    }
    ctx.log(`{green-fg}✓ server ready at ${client.baseUrl}{/green-fg}`);

    ctx.log('{gray-fg}Loading MCP servers…{/gray-fg}');
    const mcp = await McpRegistry.fromConfigs(loaded.dir, loaded.manifest.mcp);
    cached = { name: loaded.manifest.pack.name, modelId, client, mcp };
  }

  const { client, mcp } = cached;
  const runtime = new PackRuntime(loaded, mcp, client);

  ctx.log('');
  ctx.log(`{bold}─── chat with pack "${loaded.manifest.pack.name}" ───{/bold}`);
  ctx.log(`{gray-fg}${loaded.manifest.pack.description}{/gray-fg}`);
  const toolNames = mcp.listTools().map((t) => t.qualifiedName);
  if (toolNames.length > 0) ctx.log(`{gray-fg}tools: ${toolNames.join(', ')}{/gray-fg}`);
  ctx.log('{gray-fg}Escape or /exit leaves the chat.{/gray-fg}');
  ctx.log('');

  // Streaming render state for the current assistant turn.
  let region: LiveRegion | null = null;
  let acc = '';

  function beginRegion(): void {
    if (region) return;
    ctx.log('{cyan-fg}mlx ›{/cyan-fg}');
    region = ctx.streamLines();
    acc = '';
  }
  function endRegion(): void {
    region?.finalize();
    region = null;
    acc = '';
  }

  await runtime.run({
    onAssistantDelta: (d) => {
      beginRegion();
      acc += d;
      const indented = acc.split('\n').map((l) => `  ${l}`).join('\n');
      region!.write(indented);
    },
    onAssistantTurnComplete: ({ ttftMs, totalMs }) => {
      endRegion();
      ctx.log(`{gray-fg}  (ttft ${ttftMs} ms · total ${totalMs} ms){/gray-fg}`);
      ctx.log('');
    },
    onToolStart: ({ name: n, args }) => {
      endRegion();
      ctx.log(`{magenta-fg}↳ tool ${n}{/magenta-fg} {gray-fg}${truncate(JSON.stringify(args), 120)}{/gray-fg}`);
    },
    onToolEnd: ({ result, isError, ms }) => {
      const color = isError ? 'red-fg' : 'gray-fg';
      const head = truncate(result.replace(/\s+/g, ' '), 160);
      ctx.log(`  {${color}}↩ ${head}{/${color}}  {gray-fg}(${ms} ms){/gray-fg}`);
    },
    onError: (err) => {
      endRegion();
      ctx.progress(null);
      ctx.log(`{red-fg}✗ ${err.message}{/red-fg}`);
    },
    nextUserMessage: async () => {
      const u = await ctx.prompt('{green-fg}you ›{/green-fg}');
      if (u === null) return null;
      const t = u.trim();
      if (/^\/(exit|quit|bye)$/i.test(t) || t === '/') return null;
      return u;
    },
  });

  ctx.log('{gray-fg}(chat closed){/gray-fg}');
}
