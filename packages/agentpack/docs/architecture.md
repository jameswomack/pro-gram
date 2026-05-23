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

## Lifecycle: source → artifact → runtime → state

Everything in agentpack moves through four stages. Naming them explicitly keeps
the responsibilities of each module clear and tells future features (Phase 4
differential evals, trajectory diffing, model-swap divergence) where to plug in.

**1. Source** — human-edited input contracts under each pack directory:

- `pack.toml` — manifest (prompts, MCP servers, model, skills index)
- `skills/*.md` — skill bodies (auto-prepended or on-demand)
- `evals/{cases,properties,tasks}.yaml` — the three eval tiers

Source files are the only things checked into git for a pack. Everything below
is derived.

**2. Runtime** — composed in-memory state, built fresh per session:

- `loadPack(dir)` → `LoadedPack` (resolved `extends` tree, composed system
  prompt, partitioned skills, normalized model config) — `src/pack.ts`
- `McpRegistry` → live MCP clients + tool schemas in OpenAI shape —
  `src/mcp.ts`
- `PackRuntime` → the chat/tool loop with `onAssistantDelta` /
  `onToolStart` / `onToolEnd` hooks — `src/runtime.ts`
- `EvalRunner` → orchestrates tiered runs on top of `PackRuntime`,
  scripted-dispatch for unit/task, judge-call for property/task —
  `src/eval/runner.ts`

Runtime objects are ephemeral. The interesting outputs are the artifacts.

**3. Artifact** — durable, replayable records of a runtime execution:

- `<pack>/.eval-runs/<iso-timestamp>.jsonl` — one header line + one
  `CaseResult` per case. **Trajectories are persisted in full** (every
  assistant token, tool call, and `role:'tool'` result), which is what makes
  them load-bearing for downstream features:
  - Phase 4 trajectory-diff forks an artifact against an edited pack
  - Model-swap divergence replays an artifact under a different model
  - Adversarial generation seeds from artifact failure modes

The artifact format is the *contract* between Phase 2 (today) and Phase 4. If
you change `CaseResult`'s shape, you break replay.

**4. State** — aggregated views computed across artifacts:

- `diffRuns(prev, curr)` → improved / regressed / unchanged / new / removed
  buckets and per-tier mean deltas — `src/eval/diff.ts`
- `/pack eval --diff` is the only consumer today; Phase 4 differential evals
  and a future dashboard will read the same artifacts to compute different
  state views.

State is cheap to recompute and never stored — artifacts are the truth.

### Why this matters

The four-stage frame answers questions that come up when adding features:

- *"Where does the new field go?"* — input → source; intermediate → runtime;
  must replay later → artifact; aggregated view → state.
- *"What breaks if I change this?"* — source/artifact shape changes are
  contract-breaking; runtime/state changes are not.
- *"Can I cache this?"* — runtime objects, yes (we cache pack + judge model
  clients across `/pack eval` calls); artifacts, never overwrite (they're
  append-only by timestamp).

### Formal contracts

The eval runner's coordination invariants — tier ordering, sequential case
execution, atomic + complete artifact write, eventual termination — are
modeled in TLA+ at [`../tla/EvalRunner.tla`](../tla/EvalRunner.tla). The
spec exists as a **design artifact for Phase 4**: differential evals and
trajectory diffing both depend on "an artifact is either absent or
complete," and on tiers staying in fixed order. See
[`../tla/README.md`](../tla/README.md) for how to run TLC and when to
update a spec.

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

## Phase 2 — Evals (shipped)

Three tiers, run in order, budget-gated. Full file-format reference lives at
[`eval-schema.md`](eval-schema.md).

1. **Unit cases** (`cases.yaml`) — single-turn input → structural assertions
   (`contains`, `regex`, `toolCalled`, `toolArgsContain`, etc.). No judge. The
   PR-loop tier.
2. **Property checks** (`properties.yaml`) — LLM-as-judge (G-Eval style: CoT
   *then* score, leniently parsed `{score, reasoning, passes, fails}`). Cheap
   judge by default (`qwen-3b`); swap via `--judge-model=qwen-14b` for
   borderline cases.
3. **Task evals** (`tasks.yaml`) — multi-turn scripted conversation; judge
   scores the full trajectory against a rubric. Most expensive, most
   predictive.

Results land as JSONL in `<pack>/.eval-runs/<iso-timestamp>.jsonl` — one
header line plus one record per case. **Trajectories are persisted in full**
(every message including `role:'tool'` results), so a future trajectory-diff
tool can fork a recorded run against an edited pack and surface exact
divergence points.

`/pack eval <name> [--tier=1|2|3|all] [--diff] [--judge-model=qwen-3b]`:
- runs the suite,
- streams progress + per-case pass/fail with failed-assertion reasons,
- writes the JSONL,
- with `--diff`, compares the new run to the most recent prior and shows tier
  summaries (`prevMean → currMean ↑/↓`) plus improved/regressed/new/removed
  cases.

A pack model client (with the pack's preferred model + draft) and a judge
client (separate model, pinned to port 8090 so both stay up) are cached
across `/pack eval` invocations in a session. Shutdown hook closes both.

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
