# agentpack TLA+ specs

Formal models for stateful agentpack subsystems. Specs here are **design
artifacts**: they pin down the invariants the implementation must preserve, so
later phases (especially Phase 4 differential evals and trajectory diffing)
have a stable contract to build against.

## Specs

| File | Models | Covers |
|---|---|---|
| `EvalRunner.tla` | Eval runner state machine + run-file artifact | Per-case progress (queued → running → terminal), tier ordering, sequential execution, atomic + complete artifact write, eventual termination |

Each spec ships with:

- `<Name>.tla` — the model
- `MC_<Name>.tla` — bounded constants wrapper for TLC
- `<Name>.cfg` — TLC config (invariants + properties)

## Why these exist

The eval runner is ~250 LOC today. Inspection suffices for correctness *now*.
The spec exists for **Phase 4**: differential evals and trajectory diffing
will read run artifacts and replay trajectories, and both features depend on
invariants that are easy to break with a small refactor:

- "An artifact is either absent or complete." (`WriteRequiresCompletion`)
- "Tiers run in order." (`TierOrdering`)
- "One case runs at a time." (`AtMostOneRunning`)
- "Every queued case terminates." (`EventualTermination`)

Encode the invariants once, check them as the implementation evolves.

## Running TLC

You need a TLA+ tools jar (`tla2tools.jar`). Easiest path: install the
[TLA+ VS Code extension](https://marketplace.visualstudio.com/items?itemName=alygin.vscode-tlaplus)
(it bundles the jar and runs models with a right-click), or download the jar
manually:

```sh
curl -L -o /tmp/tla2tools.jar \
  https://github.com/tlaplus/tlaplus/releases/latest/download/tla2tools.jar

# Safety + liveness check (small state space; finishes in seconds)
java -XX:+UseParallelGC -jar /tmp/tla2tools.jar \
  -workers auto -config EvalRunner.cfg MC_EvalRunner.tla
```

Expected output: `Model checking completed. No error has been found.`

If TLC reports a violation, do **not** weaken the invariant to make it
pass — that defeats the point. Either the model is wrong (fix the spec) or
the implementation is about to drift away from a contract Phase 4 will
need (fix the code).

## When to update a spec

- Adding a new eval tier → add it to `TierOrder`, `Tier()`, and
  `CasesInTier()`.
- Changing artifact write semantics (e.g. streaming JSONL rather than
  one-shot `writeFile`) → `WriteRun` becomes multi-step; add an
  `incrementalWrite` state and update `WriteRequiresCompletion`.
- Allowing concurrent case execution → drop `AtMostOneRunning` and revisit
  ordering invariants carefully.

## Future specs (not yet written)

- **TrajectoryReplay.tla** — the Phase 4 invariant that replaying a stored
  trajectory against an edited pack produces a well-defined "divergence
  point" (first message index where the new run differs). Write this before
  implementing Phase 4 trajectory diffing.
