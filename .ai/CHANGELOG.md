# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### 2026-05-22 (F-009 Phase 2: agent-pack evals)

- agentpack `eval/`: full evaluation runner with three tiers. **Tier 1** (`cases.yaml`) — single-turn input + structural assertions (`contains`, `notContains`, `finalContains`, `finalNotContains`, `regex`, `toolCalled`, `toolNotCalled`, `toolArgsContain`, `minAssistantTurns`); no judge. **Tier 2** (`properties.yaml`) — single-turn input + LLM-as-judge against a rubric, G-Eval style (CoT reasoning before score, leniently parsed JSON). **Tier 3** (`tasks.yaml`) — multi-turn scripted conversation + judge over full trajectory. Per-case `maxTokens` override; per-case `threshold` for judge tiers.
- agentpack `EvalRunner` drives `PackRuntime` non-interactively via the new `onMessage` hook (also added to runtime, fires on every message push) so the runner captures full trajectories. Pack-runtime maxTokens overridable per case.
- agentpack `storage.ts`: JSONL writer/reader at `<pack>/.eval-runs/<iso>.jsonl` (one header record + one record per case; trajectory persisted in full). `listRuns()` returns runs newest-first. `.eval-runs/` is gitignored.
- agentpack `diff.ts`: `diffRuns(prev, curr)` produces per-case status (`improved` / `regressed` / `unchanged` / `new` / `removed`) plus per-tier mean + pass-count deltas.
- apps/cli `/pack eval <name> [--tier=1|2|3|all] [--diff] [--judge-model=qwen-3b]`: runs the suite, streams progress, prints per-case results with failed-assertion / judge-reasoning context, writes the JSONL, and optionally diffs against the prior run. Pack-model client and judge client cached separately (judge on port 8090) so both stay warm across invocations.
- Example evals shipped for both packs: `baseball-stats` gets 5 tier-1 cases (advanced-metric usage, tool calls, synthetic-data disclosure, BABIP regression awareness, FIP-not-ERA) + 2 tier-2 properties (skeptical-of-hyperbole, explains-not-just-cites). `astrologer` gets 4 tier-1 cases (tool use, symbolic vs predictive, house vocabulary, evocative opener) + 2 tier-2 properties (holds-two-registers on Saturn return, refuses-deterministic-prediction).
- Docs: new `packages/agentpack/docs/eval-schema.md` (full assertion + rubric reference, tips); `architecture.md` updated to mark Phase 2 shipped.
- Tests: 19 agentpack unit tests (assertions × 7, judge JSON parse × 5, diff × 2, plus existing manifest × 3 + pack × 2).

### 2026-05-22 (F-009 Phase 1: agent packs)

- New package `@jameswomack/agentpack`: a pack is a manifest (`pack.toml`) + composed system prompt + skills + MCP servers + model config. `loadPack()` parses + composes (handles `extends` inheritance, base→leaf prompt order, auto vs. on-demand skills). `McpRegistry` owns MCP client lifetimes — in-process servers via `@modelcontextprotocol/sdk` `InMemoryTransport`, external `stdio` servers as subprocesses; exposes tools in OpenAI function-call shape. `PackRuntime` drives the chat tool-loop with hooks for live streaming + tool-call rendering. 5 unit tests.
- mluxe: extended `chatStream()` with `tools` / `tool_choice` and `toolCallDelta` chunks; `chat()` and `ChatResponse` surface `tool_calls` and `finishReason`. New `ToolCall` / `ToolCallDelta` / `ToolDefinition` types exported.
- Two example packs under `packages/packs/`:
  - `baseball-stats` — sabermetrics expert with a synthetic `lookup_player` MCP tool and an advanced-metrics glossary skill.
  - `astrologer` — whimsical chart-reader with a `current_celestial_time` MCP tool and a zodiac/houses primer.
- apps/cli: `/pack list`, `/pack info <name>`, `/pack run <name>` (multi-turn chat with the pack loaded; renders tool calls inline; same `LiveRegion` streaming as `/ml chat`). Shutdown hook closes MCP clients alongside the cached mlx server.
- pnpm workspace extended with `packages/packs/*`.
- Docs: `packages/agentpack/README.md`, `packages/agentpack/docs/architecture.md` (covers Phase 1 + the eval / widget / diff-eval roadmap and cites DSPy, G-Eval, MCP, Voyager).

### 2026-05-22 (stream render fix)

- clitermus: new `ctx.streamLines()` → `LiveRegion { write, finalize }`. Opens a "live region" in the log pane backed by `box.setLine()` / `box.pushLine()` so streaming content grows lines naturally (blessed handles soft-wrap) instead of being crammed into the one-row activity bar. Static log content above and below is untouched.
- apps/cli `/ml chat`: switched the streaming render from `ctx.progress()` (one-row activity bar, tail-truncated, unreadable for multi-line replies) to `ctx.streamLines()`. The `mlx ›` header is pushed once, then the body grows in place as tokens arrive. Spinner clears on first token. Timing footer `(ttft … · total …)` is printed after the live region finalizes.

### 2026-05-22 (perf round)

- F-008: `/ml chat` perf tuning. `MluxeClient` now accepts `promptCacheSize` (default 4), `promptCacheBytes`, `draftModel`, `numDraftTokens` (default 4), and `warmup` — all forwarded to `mlx_lm.server` flags or executed post-startup. `/ml chat` exposes these as `--draft=<id|alias>`, `--cache-size=N`, `--cache-bytes=4G`, `--no-warmup`. New aliases: `qwen-14b`/`qwen-7b`/`qwen-3b`/`qwen-1.5b`/`qwen-0.5b` resolve to full HF ids. The chat loop now streams each delta to the activity bar (tail-truncated) so the user watches tokens land instead of waiting for the full response, and prints `ttft` + `total` ms after each turn. The server cache key includes the draft+cache params so changing them respawns cleanly. `MLUXE_MODEL` and new `MLUXE_DRAFT_MODEL` env vars override defaults.

### 2026-05-22

- mluxe `MluxeClient`: ring-buffer last 80 stdout/stderr lines from the spawned mlx_lm.server, capture `lastExit = {code, signal}` on death, and expose `getDiagnostics()`. Critically, **always** drain stdout/stderr (previously only drained when `onLog` was set) — a non-drained pipe fills the ~64KB kernel buffer and blocks the child on write, which presents as the server "freezing" mid-stream.
- apps/cli `/ml chat`: on stream error, dump `lastExit` + tail of recent server output to the log, evict the dead client from the cache, and exit the chat loop so the next `/ml chat` respawns cleanly. Also filtered noisy mlx_lm.server INFO / HTTP-access lines out of the chat view.
- mluxe `MluxeClient.startServer()`: robust port handling. (a) Probe the configured port first — if a compatible mlx_lm.server is already serving our model, adopt it (`adoptedExisting=true`) and skip spawning. (b) If the port is bound but not by us / wrong model, pick an OS-assigned free port and spawn there. (c) `stopServer()` is a no-op when we adopted instead of spawned, so we never kill someone else's server. Fixes the `[Errno 48] Address already in use` cascade when an mlx_lm.server lingers between sessions.
- apps/cli: registers `shutdownMlClients()` on `process.on('exit'|'SIGINT'|'SIGTERM')` so the cached mlx_lm.server child is signalled when the TUI exits. Prevents orphan python processes from holding ports across runs.
- clitermus: extended `CommandContext` with `progress(content)` (writes to the activity row, overrides the spinner) and changed `prompt(message)` to return `Promise<string | null>` — Escape during a sub-prompt now resolves with `null`. Sub-prompts can be cleanly cancelled.
- apps/cli `/ml exec` + `/ml chat`: added a pre-download confirmation flow. If the requested model isn't in the HuggingFace cache, the CLI queries the HF tree API for total size, asks the user (`1`/Enter = yes · `2`/Escape = no), then runs `huggingface_hub.snapshot_download` with live byte-progress (`current / total · pct · MB/s · elapsed`) and rotating whimsical chatter (24 messages, ~2.5s cadence, in the spirit of `/import` and Claude's status line). Helpers live in `apps/cli/src/lib/{hf-cache,ensure-model}.ts`.
- apps/cli `/ml chat`: redesigned as an interactive multi-turn loop. Entering `/ml chat` (with or without an opening prompt) starts a session that keeps `messages[]` across turns and streams each reply. Exit via Escape, `/exit`, `/quit`, `/bye`, or bare `/`. The mlx_lm.server is cached across chat sessions per model.

### 2026-05-21

- Added `@jameswomack/clitermus` (F-007): extracted CLI+TUI primitives from mlb-projections/apps/cli — Levenshtein/Damerau distance, `CommandPalette` with ghost-text autocomplete and "did you mean" correction, persistent prefix-filtered `History`, and `createTui()` blessed-backed shell. 16 unit tests.
- Built out `apps/cli` (F-004): now a real interactive TUI using clitermus + mluxe. Added "Taxonomy & Naming Philosophy" doc to apps/cli/README.md (noun × verb × modifier cube, naming rules, domain table, canonical exemplar). Registered commands: `/ml exec`, `/ml chat`, `/health api|web|all`, `/spec status`. Default model `mlx-community/Qwen2.5-14B-Instruct-4bit` (overridable via `MLUXE_MODEL` env or `--model=` flag).
- Fleshed out `@jameswomack/mluxe` (F-001 → SHIPPED): split into `client.ts` / `generate.ts` / `lora.ts` / `types.ts`; added streaming chat (`chatStream`), raw `complete`, `listModels`, log capture + graceful shutdown on the server side; standalone `generate()` for CLI/batch mode; `trainLora()` + `fuseLora()` for fine-tune mode; 11 mocked unit tests covering URL/payload/SSE parsing/banner stripping/abort.
- Initial monorepo scaffolding (F-006): pnpm workspaces, shared tsconfig, Prettier, EditorConfig
- API server skeleton (F-002): Fastify 5 with health endpoint
- Web app skeleton (F-003): Next.js 16 + React 19
- CLI skeleton (F-004): tsx-based entry point
- MLX integration package (F-001): `@jameswomack/mluxe` with MluxeClient
- AI context system (F-005): .ai/ directory with SPEC, skills, tool-configs, multi-agent symlinks
