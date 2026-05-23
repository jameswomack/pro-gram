import { describe, expect, it } from 'vitest';
import toml from '@iarna/toml';
import { PackManifestSchema } from './manifest.js';

describe('PackManifestSchema', () => {
  it('parses a minimal pack', () => {
    const t = toml.parse(`
[pack]
name = "foo"
description = "bar"

[model]
id = "qwen-7b"
`);
    const parsed = PackManifestSchema.parse(t);
    expect(parsed.pack.name).toBe('foo');
    expect(parsed.pack.version).toBe('0.1.0');
    expect(parsed.pack.extends).toEqual([]);
    expect(parsed.model.id).toBe('qwen-7b');
    expect(parsed.mcp).toEqual([]);
    expect(parsed.skill).toEqual([]);
  });

  it('parses mcp + skills', () => {
    const t = toml.parse(`
[pack]
name = "x"
description = "y"

[model]
id = "qwen-14b"
temperature = 0.4

[[mcp]]
id = "stats"
kind = "in-process"
module = "./dist/x.js"

[[mcp]]
id = "fs"
kind = "stdio"
command = "npx"
args = ["-y", "@mcp/fs", "/tmp"]

[[skill]]
id = "primer"
path = "./skills/p.md"
auto = true
`);
    const parsed = PackManifestSchema.parse(t);
    expect(parsed.mcp).toHaveLength(2);
    expect(parsed.mcp[0]).toMatchObject({ id: 'stats', kind: 'in-process', module: './dist/x.js' });
    expect(parsed.mcp[1]).toMatchObject({ id: 'fs', kind: 'stdio', command: 'npx', args: ['-y', '@mcp/fs', '/tmp'] });
    expect(parsed.skill[0]).toMatchObject({ id: 'primer', auto: true });
  });

  it('rejects an unknown mcp kind', () => {
    const t = toml.parse(`
[pack]
name = "x"
description = "y"

[model]
id = "qwen-7b"

[[mcp]]
id = "bogus"
kind = "telepathy"
`);
    expect(() => PackManifestSchema.parse(t)).toThrow();
  });
});
