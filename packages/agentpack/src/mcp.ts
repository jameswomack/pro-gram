import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { McpServerConfig } from './manifest.js';
import { modulePathFor, moduleUrlFor } from './pack.js';

/**
 * MCP-shaped tool definition as exposed by `listTools()`. Mirrors the OpenAI
 * function-call schema so it can be forwarded to `mlx_lm.server` directly.
 */
export interface ToolDef {
  /** Server-qualified name: `<serverId>__<toolName>`. Keeps tool names unique across servers. */
  qualifiedName: string;
  /** Original (unqualified) name as the server registered it. */
  name: string;
  serverId: string;
  description: string;
  /** JSON Schema for arguments — passed straight to OpenAI `tools[i].function.parameters`. */
  parameters: Record<string, unknown>;
}

export interface CallResult {
  /** Concatenated text content from the MCP CallToolResult. */
  text: string;
  isError: boolean;
}

/**
 * Manages the lifetime of every MCP client a pack needs.
 *
 *   const registry = await McpRegistry.fromConfigs(pack.dir, pack.manifest.mcp);
 *   const tools = registry.listTools();
 *   await registry.callTool('stats__lookup_player', { name: 'Trout' });
 *   await registry.close();
 *
 * In-process servers are loaded via dynamic import: the module's default export
 * must be an `@modelcontextprotocol/sdk/server` `Server` instance.
 */
export class McpRegistry {
  private clients = new Map<string, Client>();
  private inProcessServers: Server[] = [];
  private tools: ToolDef[] = [];

  static async fromConfigs(packDir: string, configs: McpServerConfig[]): Promise<McpRegistry> {
    const r = new McpRegistry();
    for (const cfg of configs) {
      await r.add(packDir, cfg);
    }
    return r;
  }

  private async add(packDir: string, cfg: McpServerConfig): Promise<void> {
    const client = new Client({ name: `agentpack/${cfg.id}`, version: '0.1.0' });

    if (cfg.kind === 'stdio') {
      const transport = new StdioClientTransport({ command: cfg.command, args: cfg.args, env: cfg.env });
      await client.connect(transport);
    } else {
      // In-process: import the module, grab its `default` (a Server), wire up a paired in-memory transport.
      const absPath = modulePathFor(packDir, cfg.module);
      const url = moduleUrlFor(absPath);
      const mod = (await import(url)) as { default?: Server };
      if (!mod.default) throw new Error(`In-process MCP module ${cfg.module} must default-export a Server instance`);
      const server = mod.default;
      this.inProcessServers.push(server);

      const [clientT, serverT] = InMemoryTransport.createLinkedPair();
      await server.connect(serverT);
      await client.connect(clientT);
    }

    this.clients.set(cfg.id, client);

    const { tools } = await client.listTools();
    for (const t of tools) {
      this.tools.push({
        qualifiedName: `${cfg.id}__${t.name}`,
        name: t.name,
        serverId: cfg.id,
        description: t.description ?? '',
        // The SDK returns `inputSchema` shaped like JSON Schema.
        parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<string, unknown>,
      });
    }
  }

  listTools(): ToolDef[] {
    return this.tools.slice();
  }

  /**
   * Render tools in the exact shape mlx_lm.server / OpenAI expect:
   *   { type: 'function', function: { name, description, parameters } }
   */
  asOpenAITools(): Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> {
    return this.tools.map((t) => ({
      type: 'function',
      function: {
        name: t.qualifiedName,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async callTool(qualifiedName: string, args: Record<string, unknown>): Promise<CallResult> {
    const tool = this.tools.find((t) => t.qualifiedName === qualifiedName);
    if (!tool) throw new Error(`No such tool: ${qualifiedName}`);
    const client = this.clients.get(tool.serverId);
    if (!client) throw new Error(`No client for server ${tool.serverId}`);

    const res = await client.callTool({ name: tool.name, arguments: args });
    const content = Array.isArray(res.content) ? res.content : [];
    const text = content
      .map((c) => {
        if (typeof c === 'object' && c && 'type' in c && c.type === 'text' && 'text' in c) {
          return String((c as { text: string }).text);
        }
        return JSON.stringify(c);
      })
      .join('\n');
    return { text, isError: Boolean(res.isError) };
  }

  async close(): Promise<void> {
    for (const c of this.clients.values()) {
      try { await c.close(); } catch { /* ignore */ }
    }
    for (const s of this.inProcessServers) {
      try { await s.close(); } catch { /* ignore */ }
    }
    this.clients.clear();
    this.inProcessServers = [];
    this.tools = [];
  }
}
