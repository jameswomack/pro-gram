# @jameswomack/agentpack

Runtime for **agent packs** — composable bundles of system prompt + skills +
MCP tools that load into an mluxe chat session. The CLI ships
`/pack list|info|run <name>` on top of this package.

## Pack shape

A pack is a workspace package (`@jameswomack/mluxe-pack-<name>`) under
`packages/packs/`:

```text
packages/packs/baseball-stats/
  package.json
  pack.toml              ← manifest (model, MCP servers, skills)
  system-prompt.md       ← the persona
  skills/
    advanced-metrics.md  ← markdown skill bodies
  src/
    mcp/stats.ts         ← in-process MCP server module
```

`pack.toml`:

```toml
[pack]
name = "baseball-stats"
description = "..."
extends = ["sports-data"]          # optional inheritance

[model]
id = "qwen-14b"
draft = "qwen-0.5b"
temperature = 0.3

[[mcp]]
id = "stats"
kind = "in-process"
module = "./dist/mcp/stats.js"

[[skill]]
id = "advanced-metrics"
path = "./skills/advanced-metrics.md"
auto = true                        # prepended to system prompt at load
```

## Architecture summary

- **`loadPack(dir)`** parses `pack.toml`, walks `extends`, composes the system
  prompt (base→leaf), splits skills into auto (always in context) vs.
  on-demand (loadable via a future meta-tool).
- **`McpRegistry`** owns the lifetime of every MCP client the pack needs.
  In-process servers run via `@modelcontextprotocol/sdk`'s `InMemoryTransport`;
  external `stdio` servers are spawned as subprocesses. Tools are exposed in
  OpenAI function-call shape via `asOpenAITools()` for forwarding to
  `mlx_lm.server`.
- **`PackRuntime`** drives the chat loop: stream a turn, accumulate tool-call
  deltas, dispatch via MCP, append `role: 'tool'` responses, re-stream until
  the model stops calling tools (or `maxToolHops` is reached). Hooks let the
  caller render live to a clitermus `LiveRegion`.

## Why MCP for everything

Tool authoring is strictly MCP-shaped — even pack-local tools. Trade-off: a
hair more ceremony per tool, in exchange for tools that work identically in
Claude Code, Claude Desktop, this CLI, and any other MCP-aware host. In-process
servers via `InMemoryTransport` keep the overhead at "one async dispatch" — no
subprocess per tool.

## Status

Phase 1 (this version): loader + tools + `/pack run`. Two example packs ship
(`baseball-stats`, `astrologer`) to prove the abstraction. Evals, widgets,
and trajectory diffing land in later phases — see
[`docs/architecture.md`](docs/architecture.md) for the roadmap.
