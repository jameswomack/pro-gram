import type { ChatMessage } from '@jameswomack/mluxe';
import type { Assertion } from './schema.js';

export interface AssertionResult {
  pass: boolean;
  message: string;
}

/**
 * Apply an assertion against a recorded trajectory. The trajectory is the
 * full `messages` array as it appeared at the end of the run (system + user +
 * assistant turns + role:'tool' results).
 */
export function evaluateAssertion(assertion: Assertion, trajectory: ChatMessage[]): AssertionResult {
  const assistantMessages = trajectory.filter((m) => m.role === 'assistant');
  const allAssistantText = assistantMessages.map((m) => m.content ?? '').join('\n');
  const finalAssistantText = assistantMessages[assistantMessages.length - 1]?.content ?? '';
  const toolCalls = assistantMessages.flatMap((m) => m.tool_calls ?? []);

  if ('contains' in assertion) {
    return mk(allAssistantText.toLowerCase().includes(assertion.contains.toLowerCase()), `contains "${assertion.contains}"`);
  }
  if ('notContains' in assertion) {
    return mk(!allAssistantText.toLowerCase().includes(assertion.notContains.toLowerCase()), `notContains "${assertion.notContains}"`);
  }
  if ('finalContains' in assertion) {
    return mk(finalAssistantText.toLowerCase().includes(assertion.finalContains.toLowerCase()), `finalContains "${assertion.finalContains}"`);
  }
  if ('finalNotContains' in assertion) {
    return mk(!finalAssistantText.toLowerCase().includes(assertion.finalNotContains.toLowerCase()), `finalNotContains "${assertion.finalNotContains}"`);
  }
  if ('regex' in assertion) {
    try {
      const re = new RegExp(assertion.regex, assertion.flags ?? 'i');
      return mk(re.test(allAssistantText), `regex /${assertion.regex}/${assertion.flags ?? 'i'}`);
    } catch (err) {
      return mk(false, `regex invalid: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if ('toolCalled' in assertion) {
    return mk(
      toolCalls.some((c) => c.function.name === assertion.toolCalled),
      `toolCalled ${assertion.toolCalled}`,
    );
  }
  if ('toolNotCalled' in assertion) {
    return mk(
      !toolCalls.some((c) => c.function.name === assertion.toolNotCalled),
      `toolNotCalled ${assertion.toolNotCalled}`,
    );
  }
  if ('toolArgsContain' in assertion) {
    const want = assertion.toolArgsContain;
    const ok = toolCalls.some((c) => {
      if (c.function.name !== want.tool) return false;
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(c.function.arguments) as Record<string, unknown>; } catch { return false; }
      return isSubsetMatch(parsed, want.args);
    });
    return mk(ok, `toolArgsContain ${want.tool} ⊇ ${JSON.stringify(want.args)}`);
  }
  if ('minAssistantTurns' in assertion) {
    return mk(assistantMessages.length >= assertion.minAssistantTurns, `minAssistantTurns ${assertion.minAssistantTurns}`);
  }
  return mk(false, `unknown assertion: ${JSON.stringify(assertion)}`);
}

function mk(pass: boolean, message: string): AssertionResult {
  return { pass, message };
}

/**
 * Loose deep-match: every key in `want` must exist in `actual` with the same
 * value (string match is case-insensitive substring). Used so a case can say
 * `toolArgsContain: {tool: "stats__lookup_player", args: {name: "Bobby Witt"}}`
 * and pass even if the model also included `season: 2025`.
 */
function isSubsetMatch(actual: Record<string, unknown>, want: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(want)) {
    const a = actual[k];
    if (a === undefined) return false;
    if (typeof v === 'string' && typeof a === 'string') {
      if (!a.toLowerCase().includes(v.toLowerCase())) return false;
    } else if (typeof v === 'object' && v !== null && typeof a === 'object' && a !== null) {
      if (!isSubsetMatch(a as Record<string, unknown>, v as Record<string, unknown>)) return false;
    } else if (a !== v) {
      return false;
    }
  }
  return true;
}
