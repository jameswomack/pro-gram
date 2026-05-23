# Widgets

Widgets let a pack ship UI affordances alongside its system prompt and tools.
The model "calls" a widget the same way it calls a tool; the runtime
intercepts the call, runs the pack-supplied renderer, fires an `onWidget`
event for the client to render, and returns a synthetic tool result to the
model so the conversation continues coherently.

## Why widgets are *almost* tools

We standardized on MCP for tools. Widgets are deliberately *not* MCP
servers — they're declarative emissions with no side effects beyond
rendering. Forcing them through MCP would be ceremony for no benefit.

From the model's perspective they're indistinguishable from MCP tools: both
appear as function-tool entries in the `tools` array sent to
`mlx_lm.server`. The distinction is purely on the runtime side — widget
tool names are prefixed `widget__` and `PackRuntime` routes them to
`WidgetRegistry.invoke()` instead of `McpRegistry.callTool()`.

## Declaring a widget

```toml
[[widget]]
id = "player_card"
description = "Render a player stat card. Call after looking up stats."
schema = "./widgets/player_card.schema.json"   # JSON Schema for args
renderer = "./dist/widgets/player_card.js"     # JS module, default export
```

The renderer module's default export must satisfy:

```ts
interface WidgetRenderer {
  renderText(args: Record<string, unknown>): string;
}
```

`renderText` returns a multi-line string. The CLI wraps the result in a
Unicode-box panel; a future web renderer will import the same module and
read a `Component` export (additive, non-breaking).

The widget's `schema` is loaded as JSON and forwarded *verbatim* to the
model as the tool's `parameters`. Make it precise — the model uses these
field descriptions to decide when to call and what to pass.

## The contract in the system prompt

Pack `system-prompt.md` files should describe widgets in a dedicated
"Widgets" section so the model knows the rendering contract is different
from data tools. Recommended phrasing:

> ## Widgets
>
> Widgets are tools whose side effect is to render a UI card for the user.
> Call one when the answer benefits from a visual summary — not for every
> turn.

Following that with one bullet per widget (when to call, expected args)
tightens the model's behavior considerably.

## What the runtime does on a widget call

1. The model emits a tool call with `name: "widget__<id>"`.
2. `PackRuntime` checks `isWidgetToolName(name)` and `widgets.has(name)`.
3. `WidgetRegistry.invoke(name, args)`:
   - Catches any renderer exception (returns an error emission, doesn't
     crash the chat).
   - Returns `{ emission, toolResult, isError }`.
4. `onWidget(emission)` fires — clients render however they want.
5. The `toolResult` (a short ack like
   `"[widget player_card rendered] Bobby Witt Jr. / Season: 2025"`) is
   appended as a `role: 'tool'` message so the model knows the widget
   appeared and can reference it in subsequent text.

## Eval assertions

Three assertion forms in `cases.yaml` test widget emission:

```yaml
- id: emits-player-card
  input: "Pull up Bobby Witt Jr.'s stat card."
  asserts:
    - toolCalled: stats__lookup_player
    - widgetEmitted: player_card
    - widgetArgsContain:
        widget: player_card
        args:
          player: "Bobby Witt"
```

`widgetEmitted` / `widgetNotEmitted` check for presence by id (no `widget__`
prefix in the assertion — id only). `widgetArgsContain` works like
`toolArgsContain`: loose subset match, case-insensitive substring on string
values.

## Authoring tips

- **Keep schemas tight.** Use `description` on every property; the model
  reads them. Mark a field `required` only if rendering really breaks
  without it.
- **Make renderers defensive.** Render whatever fields are present; never
  throw on missing data. The CLI's panel display assumes a finite,
  non-empty string.
- **One widget per concrete UI affordance.** Don't make a "card" widget
  that switches behavior on a `kind` field — make `player_card`,
  `chart_summary`, `injury_table`. Each gets its own schema, its own
  description, its own evals.
- **Propagate `synthetic` flags.** If the data backing a widget is
  illustrative, surface that on the card. The pack's system prompt should
  explicitly tell the model to pass `synthetic: true` through.

## What's missing (deferred to a future phase)

- **Web rendering.** The emission protocol is portable; `apps/web` will
  pick it up and render React components in a future phase. The renderer
  module is structured to permit a second export (`Component`) without a
  manifest change.
- **JSON Schema validation of model args.** Renderers handle malformed args
  defensively, but a strict-mode validator (Ajv) would surface schema
  violations earlier. Add when it starts biting.
- **`extends`-aggregation of widgets.** Today only the leaf pack's
  `[[widget]]` entries are loaded by the CLI (same limitation that already
  applies to `[[mcp]]`). Cross-pack inheritance of widgets is a future
  improvement.
