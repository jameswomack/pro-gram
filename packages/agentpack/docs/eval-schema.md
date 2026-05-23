# Eval file schemas

Each pack can ship up to three YAML files under `<pack>/evals/`:

```text
packages/packs/<pack>/evals/
  cases.yaml       — tier 1: structural assertions (no judge)
  properties.yaml  — tier 2: LLM-as-judge against a rubric
  tasks.yaml       — tier 3: multi-turn task with rubric
```

All three are optional. A pack with no `evals/` directory simply has nothing
to run; `/pack eval <name>` will report empty tiers.

Results land in `<pack>/.eval-runs/<iso-timestamp>.jsonl`, one record per
case plus a header line with the run summary. `.eval-runs/` is gitignored.

## Tier 1 — `cases.yaml`

Single-turn input → structural assertions on the model's reply. Cheapest tier
(no judge). Best for tool-call shape, format compliance, "did it mention this
metric?", "did it refuse to do this dumb thing?".

```yaml
cases:
  - id: leads-with-advanced-metric
    input: "Is Aaron Judge a good hitter?"
    maxTokens: 200          # optional per-case override; default 256
    asserts:
      - regex: "wRC\\+|wOBA|xwOBA"
      - finalNotContains: "best stat is batting average"

  - id: calls-tool-for-player-lookup
    input: "Look up Bobby Witt Jr.'s stats."
    asserts:
      - toolCalled: stats__lookup_player
      - toolArgsContain:
          tool: stats__lookup_player
          args:
            name: "Bobby Witt"
```

### Assertion types

| Form | Meaning |
|---|---|
| `contains: "<str>"` | substring (case-insensitive) appears in any assistant message |
| `notContains: "<str>"` | substring does *not* appear |
| `finalContains: "<str>"` | substring appears in the **last** assistant message only |
| `finalNotContains: "<str>"` | substring does *not* appear in the last assistant message |
| `regex: "<pat>", flags: "i"` | regex test against all assistant messages (default flags `i`) |
| `toolCalled: <qualified_name>` | model invoked the tool at least once |
| `toolNotCalled: <qualified_name>` | model did *not* invoke this tool |
| `toolArgsContain: {tool, args}` | some call to `tool` had `args` as a subset (strings match substring) |
| `minAssistantTurns: <n>` | model produced at least N assistant turns |

A case's **score** is `passed / total` of its assertions. It **passes** if every
assertion passes (score === 1.0). Cases with zero assertions auto-pass (useful
as a "this should at least not crash" smoke test).

## Tier 2 — `properties.yaml`

Same single-turn dispatch, then an **LLM-as-judge** (G-Eval-style) scores the
response against a rubric on `[0, 1]`. Cases pass when `score ≥ threshold`.

```yaml
properties:
  - id: skeptical-of-hyperbole
    input: "Is Aaron Judge the greatest hitter of all time?"
    threshold: 0.65            # default 0.7
    maxTokens: 512             # default 512
    rubric: |
      A strong response should:
        (a) push back on hyperbolic framing;
        (b) cite at least one advanced metric with context;
        (c) name a historical comparison or acknowledge era-adjustment;
        (d) avoid empty hype words.
```

The judge runs against whatever `--judge-model=<id|alias>` is passed to
`/pack eval` (default `qwen-3b`). Cheap-judge-first is intentional: most cases
fail or pass clearly, and only the borderline ones benefit from a stronger
judge. Re-run with `--judge-model=qwen-14b` if you want a tighter read.

The judge's reply is parsed leniently — it can be wrapped in code fences or
trailing prose; we extract the largest `{ ... }` JSON object and clamp the
`score` to `[0, 1]`.

## Tier 3 — `tasks.yaml`

Multi-turn scripted conversation. The runner feeds each `user` message in
order; the model responds (including tool calls) for each turn. After all
turns the judge scores the **full trajectory** against the rubric.

```yaml
tasks:
  - id: find-framing-catchers
    threshold: 0.7
    maxTokens: 768
    steps:
      - user: "I'm looking for catchers with strong framing this year."
      - user: "Narrow it to AL Central."
      - user: "Who improved the most year-over-year?"
    rubric: |
      By the end of the conversation, the model should have:
        (a) used the stats lookup tool at least once;
        (b) mentioned framing runs / strike-stealing in context;
        (c) limited its final list to AL Central catchers;
        (d) discussed year-over-year change in framing values.
```

Tier 3 is the most predictive of real quality and the most expensive — every
case runs N model turns plus a judge call. Budget accordingly: tier 1 for the
PR loop, tier 3 for nightly.

## Result file shape

A run file is a JSONL stream:

```jsonl
{"__record":"header","startedAt":"2026-05-22T...","pack":"baseball-stats","modelId":"qwen-14b","tiersRun":["unit"],"summary":{...},"durationMs":12345}
{"__record":"case","tier":"unit","caseId":"leads-with-advanced-metric","score":1.0,"pass":true,"durationMs":1830,"trajectory":[...],"assertions":[...]}
{"__record":"case","tier":"unit","caseId":"calls-tool-for-player-lookup","score":0.5,"pass":false,...}
```

`trajectory` is the full `messages[]` from the run (system + user + assistant
+ role:'tool' turns). That makes a recorded run a *replayable* artifact — a
future trajectory-diff tool can fork a recorded run against an edited pack
and surface where behavior diverged.

## Tips

- **Use tier 1 aggressively** for any structural property you can check.
  Don't reach for the judge when a `regex` will do.
- **Make rubrics specific.** A rubric of "be helpful" scores noise. A rubric
  with 3–5 lettered clauses (each checkable in isolation) scores signal.
- **Set `threshold` per-case**, not globally. A creative-writing rubric
  legitimately tops out near 0.6; an instruction-compliance rubric should
  demand 0.85+.
- **Tier 1 cases want low `maxTokens`** (~200). The assertions almost never
  need a long reply; capping tokens keeps the suite fast.
