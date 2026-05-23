import { z } from 'zod';

/**
 * Manifest schema for `pack.toml`. Designed to stay flat and human-editable.
 *
 *   [pack]
 *   name = "baseball-stats"
 *   description = "Sabermetrics-literate stats lookup."
 *   version = "0.1.0"
 *   extends = ["sports-data"]      # optional, resolved up the workspace tree
 *
 *   [model]
 *   id = "qwen-14b"                # alias or full HF id
 *   draft = "qwen-0.5b"            # optional
 *   temperature = 0.3
 *
 *   [[mcp]]
 *   id = "stats"
 *   kind = "in-process"            # or "stdio"
 *   module = "./mcp/stats.js"      # in-process: dist path to MCP server module
 *   # for stdio:
 *   # command = "npx"
 *   # args = ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
 *
 *   [[skill]]
 *   id = "advanced-metrics"
 *   path = "./skills/advanced-metrics.md"
 *   auto = false                   # if true, prepended to system prompt always;
 *                                  # if false, model loads via a `load_skill` meta-tool (future)
 */
export const ModelConfigSchema = z.object({
  id: z.string(),
  draft: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
});

export const McpServerConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    kind: z.literal('in-process'),
    module: z.string(),
  }),
  z.object({
    id: z.string(),
    kind: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string()).optional(),
  }),
]);

export const SkillConfigSchema = z.object({
  id: z.string(),
  path: z.string(),
  auto: z.boolean().default(false),
});

/**
 * Declares a widget — a "tool" the model can call whose side effect is to
 * render UI for the user rather than alter the world. Widgets are forwarded
 * to the model as additional entries in the `tools` array (function shape,
 * name = `widget__<id>`), but the runtime intercepts them instead of
 * dispatching to MCP. The renderer is a JS module that exports
 * `renderText(args) -> string` (used by the CLI today; a future React
 * component export will plug into apps/web without a protocol change).
 *
 *   [[widget]]
 *   id = "player_card"
 *   description = "Render a player stat card. Call after looking up stats."
 *   schema = "./widgets/player_card.schema.json"
 *   renderer = "./dist/widgets/player_card.js"
 */
export const WidgetConfigSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** Path to a JSON file with the widget's args JSON Schema. */
  schema: z.string(),
  /** Path to a JS module default-exporting `{ renderText(args): string }`. */
  renderer: z.string(),
});

export const PackManifestSchema = z.object({
  pack: z.object({
    name: z.string(),
    description: z.string(),
    version: z.string().default('0.1.0'),
    extends: z.array(z.string()).default([]),
    systemPrompt: z.string().default('./system-prompt.md'),
  }),
  model: ModelConfigSchema,
  mcp: z.array(McpServerConfigSchema).default([]),
  skill: z.array(SkillConfigSchema).default([]),
  widget: z.array(WidgetConfigSchema).default([]),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type SkillConfig = z.infer<typeof SkillConfigSchema>;
export type WidgetConfig = z.infer<typeof WidgetConfigSchema>;
export type PackManifest = z.infer<typeof PackManifestSchema>;
