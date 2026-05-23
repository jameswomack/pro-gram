import type {
  ChatMessage,
  MluxeClient,
  ToolCall,
  ToolCallDelta,
} from '@jameswomack/mluxe';
import type { McpRegistry } from './mcp.js';
import type { LoadedPack } from './pack.js';

export interface PackRuntimeHooks {
  /** Called once when the system prompt is composed (e.g. to log it). */
  onSystemPrompt?: (text: string) => void;
  /** Called when the user's message is added to the conversation. */
  onUserMessage?: (text: string) => void;
  /** Append-only text from the assistant, including tool-call previews. */
  onAssistantDelta?: (text: string) => void;
  /** Final assistant text for the turn (after tool loop settles). */
  onAssistantTurnComplete?: (info: { text: string; ttftMs: number; totalMs: number }) => void;
  /** Tool call about to be dispatched. */
  onToolStart?: (call: { name: string; args: Record<string, unknown> }) => void;
  /** Tool call completed (or errored). */
  onToolEnd?: (info: { name: string; result: string; isError: boolean; ms: number }) => void;
  /** Errors surfaced to the user (network, parse, etc.). */
  onError?: (err: Error) => void;
  /**
   * Fires every time a message is pushed onto the conversation — user,
   * assistant, or tool. The eval runner uses this to record full trajectories
   * without owning the message array.
   */
  onMessage?: (msg: ChatMessage) => void;
  /**
   * Source of the next user turn. Resolve `null` to end the chat. The runtime
   * calls this between turns.
   */
  nextUserMessage: () => Promise<string | null>;
}

export interface PackRuntimeOptions {
  /** Max tool-call hops in a single turn before we bail. Prevents runaway loops. */
  maxToolHops?: number;
}

/**
 * Drive a multi-turn chat against `pack` using `client` as the model backend.
 *
 *   const runtime = new PackRuntime(pack, mcp, client);
 *   await runtime.run({ nextUserMessage: () => ctx.prompt('you ›'), ... });
 *
 * Lifecycle per user turn:
 *   1. Push the user message.
 *   2. Stream the assistant turn (content + tool-call deltas).
 *   3. If tool_calls were emitted, execute them via MCP, push role:'tool'
 *      messages, and stream again. Repeat up to `maxToolHops` times.
 *   4. Yield back to `hooks.nextUserMessage()`.
 */
export class PackRuntime {
  constructor(
    private pack: LoadedPack,
    private mcp: McpRegistry,
    private client: MluxeClient,
  ) {}

  async run(hooks: PackRuntimeHooks, opts: PackRuntimeOptions = {}): Promise<void> {
    const maxHops = opts.maxToolHops ?? 4;
    const messages: ChatMessage[] = [{ role: 'system', content: this.pack.systemPrompt }];
    hooks.onSystemPrompt?.(this.pack.systemPrompt);
    hooks.onMessage?.(messages[0]!);

    /** Push to messages and fire onMessage in one place so trajectory recording stays in sync. */
    const push = (m: ChatMessage): void => {
      messages.push(m);
      hooks.onMessage?.(m);
    };

    const tools = this.mcp.asOpenAITools();

    while (true) {
      const userText = await hooks.nextUserMessage();
      if (userText === null) return;
      const trimmed = userText.trim();
      if (!trimmed) continue;

      push({ role: 'user', content: trimmed });
      hooks.onUserMessage?.(trimmed);

      for (let hop = 0; hop < maxHops; hop++) {
        const turnStart = Date.now();
        let firstTokenAt = 0;
        let assistantText = '';
        const assemblyCalls: AssembledCall[] = [];

        try {
          for await (const chunk of this.client.chatStream(messages, {
            tools: tools.length > 0 ? tools : undefined,
            ...(this.pack.model.temperature !== undefined ? { temperature: this.pack.model.temperature } : {}),
            ...(this.pack.model.maxTokens !== undefined ? { max_tokens: this.pack.model.maxTokens } : {}),
          })) {
            if (chunk.done) break;
            if (chunk.delta && !firstTokenAt) firstTokenAt = Date.now();
            if (chunk.delta) {
              assistantText += chunk.delta;
              hooks.onAssistantDelta?.(chunk.delta);
            }
            if (chunk.toolCallDelta) {
              applyToolCallDelta(assemblyCalls, chunk.toolCallDelta);
            }
          }
        } catch (err) {
          hooks.onError?.(err instanceof Error ? err : new Error(String(err)));
          messages.pop(); // remove the user message so they can retry
          break;
        }

        const totalMs = Date.now() - turnStart;
        const ttftMs = firstTokenAt ? firstTokenAt - turnStart : 0;

        const finalizedCalls: ToolCall[] = assemblyCalls
          .filter((c) => c.id && c.functionName)
          .map((c) => ({
            id: c.id!,
            type: 'function' as const,
            function: { name: c.functionName!, arguments: c.argumentsBuf },
          }));

        // Record this assistant turn.
        push({
          role: 'assistant',
          content: assistantText,
          ...(finalizedCalls.length > 0 ? { tool_calls: finalizedCalls } : {}),
        });

        if (finalizedCalls.length === 0) {
          hooks.onAssistantTurnComplete?.({ text: assistantText, ttftMs, totalMs });
          break; // back to user input
        }

        // Execute each tool call, append role:'tool' responses, then loop.
        for (const call of finalizedCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
          } catch {
            // Pass the raw string through if it isn't valid JSON; some models emit lazy args.
            args = { _raw: call.function.arguments };
          }
          hooks.onToolStart?.({ name: call.function.name, args });
          const t0 = Date.now();
          let resultText = '';
          let isError = false;
          try {
            const r = await this.mcp.callTool(call.function.name, args);
            resultText = r.text;
            isError = r.isError;
          } catch (err) {
            resultText = err instanceof Error ? err.message : String(err);
            isError = true;
          }
          hooks.onToolEnd?.({ name: call.function.name, result: resultText, isError, ms: Date.now() - t0 });
          push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: resultText,
          });
        }
        // Loop to let the model react to the tool outputs.
        if (hop === maxHops - 1) {
          hooks.onError?.(new Error(`maxToolHops=${maxHops} exceeded; stopping the turn`));
        }
      }
    }
  }
}

interface AssembledCall {
  id?: string;
  functionName?: string;
  argumentsBuf: string;
}

function applyToolCallDelta(buffer: AssembledCall[], delta: ToolCallDelta): void {
  const idx = delta.index;
  if (!buffer[idx]) buffer[idx] = { argumentsBuf: '' };
  const slot = buffer[idx]!;
  if (delta.id && !slot.id) slot.id = delta.id;
  if (delta.function?.name && !slot.functionName) slot.functionName = delta.function.name;
  if (delta.function?.arguments) slot.argumentsBuf += delta.function.arguments;
}
