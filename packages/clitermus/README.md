# @jameswomack/clitermus

Reusable CLI + TUI primitives. Extracted from `ballpark-genius` / `mlb-projections`
so the input/output/history/autocomplete layer doesn't get re-implemented per app.

## What's in the box

| Export | Purpose |
|---|---|
| `levenshtein`, `damerauLevenshtein` | Edit-distance functions. Pure, no deps. |
| `CommandPalette` | Ranked autocomplete with ghost text, dropdown, "did you mean", namespace lookup. |
| `History` | Persistent, prefix-filtered command history (arrow-key cycling). |
| `createTui(opts)` | A blessed-backed TUI shell: status row, scrollable log, single-line input, dispatch loop. |

## Command model

Commands live on a `noun verb` grid (see the consumer app's "Taxonomy & Naming Philosophy"):

```ts
import { createTui } from '@jameswomack/clitermus';

createTui({
  title: 'pro-gram CLI',
  prompt: '/',
  commands: [
    {
      name: 'ml exec',
      description: 'Run a one-shot prompt against the default LLM.',
      async handler({ args, log }) {
        log(`Running: ${args.join(' ')}`);
      },
    },
  ],
}).start();
```

The user invokes `/ml exec "hello"` at the prompt. The palette autocompletes,
Levenshtein-corrects, and dispatches to the matching handler.

## Status

`v0.1.0-alpha` — internal use first. Will publish to npm once the API stabilizes.
For local linking before that: `pnpm link --global` in this package, then
`pnpm link --global @jameswomack/clitermus` in the consuming app. A workspace
dependency (`"@jameswomack/clitermus": "workspace:*"`) inside this monorepo is
the preferred path until publish.
