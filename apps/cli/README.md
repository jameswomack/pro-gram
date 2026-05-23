# @jameswomack/cli

Command-line tools and interactive TUI for the pro-gram monorepo. Built on
[`@jameswomack/clitermus`](../../packages/clitermus) for the input/output/history/Levenshtein layer.

## Usage

```bash
pnpm --filter @jameswomack/cli start          # launch interactive TUI
pnpm --filter @jameswomack/cli start ml exec "hello"   # one-shot shell mode (planned)
```

## Development

```bash
pnpm --filter @jameswomack/cli dev    # Watch mode
pnpm --filter @jameswomack/cli test   # Run tests
```

> **First-run note.** Workspace packages (`@jameswomack/clitermus`, `@jameswomack/mluxe`)
> compile to `dist/` which is **not** in git. After a fresh checkout or `pnpm install`,
> run `pnpm -r build` once before `pnpm --filter @jameswomack/cli start` — otherwise
> tsx will fail with `Cannot find module '.../dist/index.js'`.

## `/ml` flags & aliases

`/ml exec "prompt" [--model=…] [--max-tokens=N] [--format=text|json]`

`/ml chat [opening] [--model=…] [--draft=…] [--cache-size=N] [--cache-bytes=4G] [--no-warmup]`

Model alias shortcuts (resolve to `mlx-community/*-Instruct-4bit`):

| Alias       | Repo                                              | Size  | Use                              |
|-------------|---------------------------------------------------|-------|----------------------------------|
| `qwen-14b`  | `mlx-community/Qwen2.5-14B-Instruct-4bit`         | ~8 GB | Default. Best quality.           |
| `qwen-7b`   | `mlx-community/Qwen2.5-7B-Instruct-4bit`          | ~4 GB | ~2× faster, modest quality drop. |
| `qwen-3b`   | `mlx-community/Qwen2.5-3B-Instruct-4bit`          | ~2 GB | ~4× faster, casual chat.         |
| `qwen-1.5b` | `mlx-community/Qwen2.5-1.5B-Instruct-4bit`        | ~1 GB | Very fast, smart-enough.         |
| `qwen-0.5b` | `mlx-community/Qwen2.5-0.5B-Instruct-4bit`        | ~0.3 GB | Best as a `--draft` partner.   |

Performance tips (default config already turns these on where free):

- **Prompt cache** is on by default (4 slots). Multi-turn chats see ~2–5× lower latency on turn 2+.
- **Warm-up shot** is on by default. Costs a few seconds at startup; eliminates compile latency on the user's first real turn.
- **Speculative decoding** is opt-in. `--draft=qwen-0.5b` with the 14B main usually nets ~1.5–2× throughput at no quality cost. ([deep dive](../../packages/mluxe/docs/speculative-decoding.md))
- **Smaller model**: `--model=qwen-7b` is the easiest big lever.

Environment overrides: `MLUXE_MODEL`, `MLUXE_DRAFT_MODEL`, `MLUXE_PYTHON`.

---

## Taxonomy & Naming Philosophy

Every `cli` invocation occupies one coordinate in a three-axis space. The shape of the
subcommand tree is a **cube**, not a list — and that's deliberate.

### The 3D command cube

```text
                    Z: modifier
                    (--format=text)
                          ▲
                          │
                          │
                          │   Y: action
                          │   (exec)
                          │     ▲
                          │    ╱
                          │   ╱
                          │  ╱
                          │ ╱
                          │╱
                          ●────────────▶ X: domain (ml)

         cli ml exec --format=text "Hello, world."
             └X┘ └Y┘ └────Z────┘ └────arg────┘
```

- **X — domain** (noun): the broad subsystem this command operates on.
  Examples: `ml`, `model`, `db`, `health`, `spec`, `cache`.
- **Y — action** (verb): what to do within that domain.
  Examples: `exec`, `list`, `show`, `install`, `get`, `set`, `status`, `clear`.
- **Z — modifier** (flag): tunes _how_, never _what_.
  Examples: `--format`, `--model`, `--provider`, `--max-tokens`, `--stream`.

The positional argument(s) are the **operand** — the prompt text, the table name,
the model id. Operands ride along the X/Y/Z point; they aren't an axis of their own.

### Why three dimensions

A flat list (`/qwen`, `/backup`, `/cache-clear`, `/health-api`, …) collapses every
command into one undifferentiated row. Fifty commands become fifty names to memorize,
each its own bespoke spelling.

A noun×verb cube is **finite and discoverable**:

- Memorize ~8 nouns and ~6 verbs → 48 cells. Most are empty; the populated ones
  follow from the grid.
- New features add a verb to an existing noun (cheap, predictable) or a new noun
  (rare, intentional).
- `cli help` lists nouns. `cli help <noun>` lists that noun's verbs. The shape
  of the cube _is_ the documentation.

### Naming rules

1. **Domains are generalities, never proper nouns.** Use `ml`, not `qwen`/`claude`/`mlx`.
   Brand and model names belong in `--model` / `--provider` flags. `qwen2.5:14b` is a
   value, not a command.
2. **Actions are short verbs.** `exec`, `get`, `set`, `list`, `show`, `install`,
   `clear`, `status`. If you'd write `execute-and-stream`, that's `exec --stream`,
   not a new action.
3. **One verb per intent.** Don't ship both `list` and `ls`, or `show` and `print`,
   for the same operation. Pick one; alias the other only as a hidden convenience.
4. **Flags are nouns.** `--format`, `--model`. The verb is already the action; the
   flag describes the noun being modulated.
5. **Format is a modifier, not an action.** `cli ml exec --format=json`, not
   `cli ml exec-json`.
6. **Positional args are the operand.** `cli ml exec "summarize this"` — the
   prompt is the thing being acted on, not a flag.

### Domains, current and planned

| Domain   | Purpose                                        | Example commands                               |
|----------|------------------------------------------------|------------------------------------------------|
| `ml`     | Run / interact with language models            | `ml exec`, `ml chat`, `ml stream`              |
| `model`  | Manage model artifacts on disk                 | `model install`, `model list`, `model remove`  |
| `db`     | Inspect the data layer behind the API          | `db query`, `db tables`, `db count`            |
| `health` | App / dependency liveness                      | `health api`, `health web`, `health all`       |
| `spec`   | pro-gram living spec & project mgmt            | `spec status`, `spec features`, `spec next`    |
| `cache`  | Cache lifecycle                                | `cache clear`, `cache stats`                   |

Empty cells in the grid are not implementation gaps — they're permission to grow.
Adding a new cell means picking a verb that already exists in the lexicon; the
taxonomy says where the handler goes before the code is written.

### Slash vs shell — one tree, two surfaces

The CLI runs in two modes that **share a single command tree**:

- **Interactive TUI** — `cli` launches; you type `/ml exec "..."` at the prompt.
- **Shell one-shot** — `cli ml exec "..."` runs and exits.

`/<domain> <action> [args]` inside the TUI is exactly `<domain> <action> [args]`
from the shell. No separator drift — same tokens, same grammar, same handler.

### Canonical exemplar

```text
cli ml exec --format=text "What's a good way to value catcher framing?"
```

- `ml` — domain (machine learning, _not_ a brand)
- `exec` — action (run a one-shot prompt, return result, exit)
- `--format=text` — modifier (text is the default; shown here for clarity)
- `"What's a good way to value catcher framing?"` — operand (the prompt)

Under the hood this routes to [`@jameswomack/mluxe`](../../packages/mluxe)'s
`generate()` (CLI mode) or `MluxeClient.chat()` (server mode) depending on
`--mode`, with the model resolved from `--model` (default:
`mlx-community/Qwen2.5-14B-Instruct-4bit`).

### When in doubt

Ask: _"Could a future contributor guess this command's name from the grid?"_
If yes, ship it. If no — either the noun is wrong (too specific, a brand)
or the verb is wrong (too clever, a phrase). Rework before merging.
