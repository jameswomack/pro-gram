# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
