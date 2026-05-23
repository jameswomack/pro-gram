import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPack } from './pack.js';

let dir: string;

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agentpack-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function writePack(name: string, files: Record<string, string>): string {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const full = join(d, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return d;
}

describe('loadPack', () => {
  it('loads a pack with auto + on-demand skills', async () => {
    const d = writePack('p', {
      'pack.toml': `
[pack]
name = "p"
description = "test"

[model]
id = "qwen-7b"
temperature = 0.5

[[skill]]
id = "always"
path = "./skills/a.md"
auto = true

[[skill]]
id = "later"
path = "./skills/b.md"
auto = false
`,
      'system-prompt.md': 'I am the system.',
      'skills/a.md': 'AUTO_SKILL_BODY',
      'skills/b.md': 'ONDEMAND_BODY',
    });

    const loaded = await loadPack(d);
    expect(loaded.manifest.pack.name).toBe('p');
    expect(loaded.model.temperature).toBe(0.5);
    expect(loaded.systemPrompt).toContain('I am the system.');
    expect(loaded.systemPrompt).toContain('AUTO_SKILL_BODY');
    expect(loaded.systemPrompt).not.toContain('ONDEMAND_BODY');
    expect(loaded.ondemandSkills).toHaveLength(1);
    expect(loaded.ondemandSkills[0]?.id).toBe('later');
    expect(loaded.ondemandSkills[0]?.body).toBe('ONDEMAND_BODY');
  });

  it('follows extends and composes prompts in base→leaf order', async () => {
    writePack('base', {
      'pack.toml': `
[pack]
name = "base"
description = "base"

[model]
id = "qwen-14b"
temperature = 0.2
`,
      'system-prompt.md': 'BASE_PROMPT',
    });
    const leafDir = writePack('leaf', {
      'pack.toml': `
[pack]
name = "leaf"
description = "leaf"
extends = ["base"]

[model]
id = "qwen-7b"
`,
      'system-prompt.md': 'LEAF_PROMPT',
    });
    const loaded = await loadPack(leafDir, {
      resolveExtends: async (n) => join(dir, n),
    });
    // Base first, leaf last
    const basePos = loaded.systemPrompt.indexOf('BASE_PROMPT');
    const leafPos = loaded.systemPrompt.indexOf('LEAF_PROMPT');
    expect(basePos).toBeGreaterThanOrEqual(0);
    expect(leafPos).toBeGreaterThan(basePos);
    // Leaf wins on model id but base temperature falls through
    expect(loaded.model.id).toBe('qwen-7b');
    expect(loaded.model.temperature).toBe(0.2);
  });
});
