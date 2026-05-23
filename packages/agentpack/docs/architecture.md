# agentpack architecture & roadmap

Design notes for the agent-pack system. Phase 1 is shipping; Phases 2–4 are
planned. Tracked as F-009 in `.ai/SPEC.md`.

## The core abstraction

A **pack** is a directory whose manifest (`pack.toml`) declares everything the
runtime needs to put a model into a particular "mode":

- A composed **system prompt** (base prompts via `extends`, plus auto-skills)
- **MCP servers** providing tools (in-process for pack-local, stdio for external)
- **Skills** — markdown bodies that are either auto-prepended to the system
  prompt or available to load on demand later
- A **model config** (alias or full HF id, optional draft model, sampling params)

Packs compose via `extends`: leaf packs inherit prompts/skills/MCP from bases.
Today the resolver in `apps/cli` looks bases up by simple directory name under
`packages/packs/`; if we need cross-repo packs later this can be swapped for an
npm-style resolver.

## Phase 1 (shipping)

- `loadPack(dir)` — manifest parsing, prompt composition, skill split.
- `McpRegistry` — manages MCP client lifetimes; exposes tools in OpenAI shape.
- `PackRuntime` — chat loop with tool dispatching, `onAssistantDelta` and
  `onToolStart`/`onToolEnd` hooks for the CLI to render live to a clitermus
  `LiveRegion`.
- `/pack list`, `/pack info <name>`, `/pack run <name>` in apps/cli.
- Two example packs:
  - `baseball-stats` — sabermetrics expert; synthetic `lookup_player` tool.
  - `astrologer` — whimsical chart-reader; coarse `current_celestial_time` tool.

## Phase 2 — Evals (planned)

Three tiers, run in order, budget-gated:

1. **Unit cases** — YAML `input → expected substring/regex/JSON shape`. Cheap;
   for tool-call shape, format compliance.
2. **Property checks** — LLM-as-judge with chain-of-thought rubric (G-Eval
   style). Cheap judge first (Qwen-3B), main judge only on borderline cases.
3. **Task evals** — end-to-end task with multi-step rubric. Most expensive,
   most predictive of real quality.

Results stored as JSONL in `packages/packs/<name>/.eval-runs/`. `/pack eval
<name> [--tier=N] [--diff]` runs the suite and diffs against the most recent
run. Trajectories (full message + tool trace) recorded for replay.

## Phase 3 — Widgets (planned)

Each pack can declare `[[widget]]` entries: a JSON schema for the data shape
and a reference to a React component in `apps/web`. The model emits a
structured `<widget …>` tag (or JSON blob); the web app renders. CLI shows a
collapsed text representation.

Eval extension: score whether the right widget was emitted for the right
query.

## Phase 4 — The novel stuff

These are not in OpenAI Evals, DSPy, Inspect, or LangSmith today:

1. **Differential evals.** On edit, re-run only the eval cases whose
   dependencies (tools/skills/system-prompt fragments) intersect the diff.
   Incremental-build style.
2. **Trajectory diffing.** Replay a recorded session against the edited pack.
   Show *where* behavior diverged — tool choice, plan, phrasing — not just
   whether the score moved.
3. **Model-swap divergence.** Record with the 14B; replay with the 3B; emit a
   list of turns where the small model would fail. Output: a hybrid config
   recommendation.
4. **Adversarial test generation.** A "red team" pack that, given a target
   pack and known failure modes, generates adversarial prompts. Stored as new
   eval cases.

## Performance notes

- The pack's system prompt + auto-skills + tool schemas form a fixed prefix
  per session — exactly what `mlx_lm.server`'s `--prompt-cache-size` is for.
  We already wire `promptCacheSize=4` in the CLI; pack-aware caching means
  repeated `/pack run` for the same pack hits a warm cache.
- In-process MCP via `InMemoryTransport` avoids subprocess overhead for
  pack-local tools. Stdio MCP is only paid when the pack actually needs an
  external server.
- Tool-call loops are capped at `maxToolHops` (default 4) so a buggy model
  can't burn the chip in a runaway loop.

## What we deliberately didn't build (yet)

- Pack publishing to npm (the workspace path works; npm is for the day we want
  packs reusable across repos).
- Sandboxing of stdio MCP servers. Today they run with the same permissions as
  the CLI. Fine for trusted local development; a `--sandbox` flag is the right
  follow-up before we accept third-party packs.
- A widget renderer (Phase 3).
- An eval runner (Phase 2).

## References

- **DSPy** (Khattab et al., 2024) — programmatic prompt optimization. Our eval
  story should converge here.
- **G-Eval** (Liu et al., 2023) — LLM-as-judge with rubric + CoT.
- **τ-bench / AgentBench / SWE-bench** — task-eval gold standard.
- **MCP** (Anthropic, 2024) — tool protocol we standardize on.
- **Voyager** (Wang et al., 2023) — skill-library growth (Phase ≥4 inspiration).
