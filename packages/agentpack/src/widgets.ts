import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WidgetConfig } from './manifest.js';

/** Prefix used for widget tool names so PackRuntime can route them. */
export const WIDGET_TOOL_PREFIX = 'widget__';

export interface WidgetDef {
  id: string;
  /** OpenAI tool name, e.g. `widget__player_card`. */
  toolName: string;
  description: string;
  /** Loaded JSON Schema for args (forwarded to the model verbatim). */
  schema: Record<string, unknown>;
  /** Loaded renderer module (default export). */
  renderer: WidgetRenderer;
  /** Source pack name, useful for diagnostics. */
  origin: string;
}

export interface WidgetRenderer {
  /**
   * Produce a multi-line text representation suitable for a terminal panel.
   * The CLI wraps the return value in a box; the renderer should not include
   * borders itself.
   */
  renderText(args: Record<string, unknown>): string;
}

export interface WidgetEmission {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  /** The renderer's textual output. */
  text: string;
  origin: string;
}

/**
 * Loads and validates widget declarations for a pack. Renderers are dynamic-
 * imported so the pack's build output is what's actually executed (matches
 * how MCP modules are loaded — see `mcp.ts`).
 */
export class WidgetRegistry {
  private widgets = new Map<string, WidgetDef>();

  static async fromConfigs(packDir: string, origin: string, configs: WidgetConfig[]): Promise<WidgetRegistry> {
    const r = new WidgetRegistry();
    for (const cfg of configs) {
      await r.add(packDir, origin, cfg);
    }
    return r;
  }

  /** Merge another registry into this one (used when a pack extends another). */
  merge(other: WidgetRegistry): void {
    for (const w of other.widgets.values()) {
      this.widgets.set(w.id, w);
    }
  }

  private async add(packDir: string, origin: string, cfg: WidgetConfig): Promise<void> {
    const schemaPath = path.resolve(packDir, cfg.schema);
    const rendererPath = path.resolve(packDir, cfg.renderer);
    let schema: Record<string, unknown>;
    try {
      schema = JSON.parse(await readFile(schemaPath, 'utf-8')) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Failed to load widget schema for ${cfg.id} at ${schemaPath}: ${err instanceof Error ? err.message : err}`);
    }
    const mod = (await import(pathToFileURL(rendererPath).href)) as { default?: WidgetRenderer };
    if (!mod.default || typeof mod.default.renderText !== 'function') {
      throw new Error(`Widget renderer ${cfg.id} at ${rendererPath} must default-export an object with renderText(args)`);
    }
    this.widgets.set(cfg.id, {
      id: cfg.id,
      toolName: `${WIDGET_TOOL_PREFIX}${cfg.id}`,
      description: cfg.description,
      schema,
      renderer: mod.default,
      origin,
    });
  }

  has(idOrToolName: string): boolean {
    return Boolean(this.find(idOrToolName));
  }

  find(idOrToolName: string): WidgetDef | undefined {
    if (this.widgets.has(idOrToolName)) return this.widgets.get(idOrToolName);
    const id = idOrToolName.startsWith(WIDGET_TOOL_PREFIX)
      ? idOrToolName.slice(WIDGET_TOOL_PREFIX.length)
      : idOrToolName;
    return this.widgets.get(id);
  }

  list(): WidgetDef[] {
    return Array.from(this.widgets.values());
  }

  /**
   * Render OpenAI function-tool entries for every widget. These get appended
   * to the `tools` array sent to mlx_lm.server alongside MCP tools.
   */
  asOpenAITools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return this.list().map((w) => ({
      type: 'function',
      function: {
        name: w.toolName,
        description: w.description,
        parameters: w.schema,
      },
    }));
  }

  /**
   * Invoke a widget. Returns the emission record (for hook dispatch) plus the
   * synthetic tool-result text the runtime will send back to the model so it
   * knows the widget rendered.
   *
   * Renderer errors are caught: we return an emission with an error string
   * so a single malformed model call doesn't crash a long conversation.
   */
  invoke(idOrToolName: string, rawArgs: Record<string, unknown>): { emission: WidgetEmission; toolResult: string; isError: boolean } {
    const def = this.find(idOrToolName);
    if (!def) {
      const result = `widget "${idOrToolName}" not declared by this pack`;
      return {
        emission: { id: idOrToolName, toolName: idOrToolName, args: rawArgs, text: result, origin: 'unknown' },
        toolResult: result,
        isError: true,
      };
    }
    try {
      const text = def.renderer.renderText(rawArgs);
      const compact = text.split('\n').slice(0, 3).join(' / ');
      const toolResult = `[widget ${def.id} rendered] ${compact}${text.split('\n').length > 3 ? ' …' : ''}`;
      return {
        emission: { id: def.id, toolName: def.toolName, args: rawArgs, text, origin: def.origin },
        toolResult,
        isError: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        emission: { id: def.id, toolName: def.toolName, args: rawArgs, text: `(render error: ${msg})`, origin: def.origin },
        toolResult: `widget render error: ${msg}`,
        isError: true,
      };
    }
  }
}

/** True if a tool name belongs to a widget (vs an MCP tool). */
export function isWidgetToolName(name: string): boolean {
  return name.startsWith(WIDGET_TOOL_PREFIX);
}
