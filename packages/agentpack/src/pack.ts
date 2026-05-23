import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import toml from '@iarna/toml';
import { PackManifestSchema, type PackManifest, type ModelConfig } from './manifest.js';

export interface LoadedPack {
  /** Directory containing pack.toml */
  dir: string;
  manifest: PackManifest;
  /** Composed system prompt (own + auto skills + extends). */
  systemPrompt: string;
  /** Skills not auto-loaded — available to load on demand. */
  ondemandSkills: LoadedSkill[];
  /** Effective model config after merging extends. */
  model: ModelConfig;
}

export interface LoadedSkill {
  id: string;
  body: string;
  /** Pack the skill came from (own or extends source). */
  origin: string;
}

const MAX_EXTENDS_DEPTH = 4;

/**
 * Resolve, parse, and compose a pack at `dir`. Follows `extends` recursively
 * (depth-capped) so a pack inherits system prompt, skills, and MCP servers from
 * its bases. Later layers (the leaf pack) override earlier ones field by field.
 */
export async function loadPack(dir: string, opts: { resolveExtends?: (name: string) => Promise<string> } = {}): Promise<LoadedPack> {
  const chain = await collectChain(path.resolve(dir), opts.resolveExtends, 0);
  // chain[0] is the deepest base; chain[chain.length-1] is the leaf.
  const leaf = chain[chain.length - 1]!;

  // Compose model: leaf wins, but undefined fields fall through to bases.
  const model: ModelConfig = chain.reduce<ModelConfig>((acc, link) => ({ ...acc, ...stripUndefined(link.manifest.model) }), { id: 'qwen-14b' });

  // Compose system prompt: base prompts first, then leaf last, separated by horizontal rules.
  const promptParts: string[] = [];
  for (const link of chain) {
    const p = path.resolve(link.dir, link.manifest.pack.systemPrompt);
    const text = await readFile(p, 'utf-8');
    promptParts.push(text.trim());
  }

  // Compose skills: auto-skills get appended to the system prompt; on-demand skills are returned.
  const ondemandSkills: LoadedSkill[] = [];
  const autoSkillBodies: string[] = [];
  for (const link of chain) {
    for (const skill of link.manifest.skill) {
      const body = (await readFile(path.resolve(link.dir, skill.path), 'utf-8')).trim();
      if (skill.auto) {
        autoSkillBodies.push(`### Skill: ${skill.id}\n\n${body}`);
      } else {
        ondemandSkills.push({ id: skill.id, body, origin: link.manifest.pack.name });
      }
    }
  }

  const systemPrompt = [
    ...promptParts,
    ...(autoSkillBodies.length ? ['\n---\n## Loaded skills', ...autoSkillBodies] : []),
  ].join('\n\n');

  return {
    dir: leaf.dir,
    manifest: leaf.manifest,
    systemPrompt,
    ondemandSkills,
    model,
  };
}

interface ChainLink {
  dir: string;
  manifest: PackManifest;
}

async function collectChain(
  dir: string,
  resolveExtends: ((name: string) => Promise<string>) | undefined,
  depth: number,
): Promise<ChainLink[]> {
  if (depth > MAX_EXTENDS_DEPTH) throw new Error(`pack extends chain exceeds depth ${MAX_EXTENDS_DEPTH} at ${dir}`);
  const manifestPath = path.join(dir, 'pack.toml');
  const raw = await readFile(manifestPath, 'utf-8');
  const parsed = PackManifestSchema.parse(toml.parse(raw));

  const out: ChainLink[] = [];
  for (const ext of parsed.pack.extends) {
    if (!resolveExtends) throw new Error(`pack at ${dir} extends "${ext}" but no resolver was provided`);
    const extDir = await resolveExtends(ext);
    out.push(...(await collectChain(extDir, resolveExtends, depth + 1)));
  }
  out.push({ dir, manifest: parsed });
  return out;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** Helper for in-process MCP modules: convert a file:// URL string to a path. */
export function modulePathFor(packDir: string, modulePath: string): string {
  if (modulePath.startsWith('file://')) return fileURLToPath(modulePath);
  return path.resolve(packDir, modulePath);
}

/** Convert an absolute path to a file:// URL suitable for dynamic import. */
export function moduleUrlFor(absPath: string): string {
  return pathToFileURL(absPath).href;
}
