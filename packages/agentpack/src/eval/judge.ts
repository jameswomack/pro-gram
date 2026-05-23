import type { ChatMessage, MluxeClient } from '@jameswomack/mluxe';

/**
 * G-Eval-flavored LLM-as-judge. Given a rubric, the user's input, and the
 * model's full trajectory, produce a 0–1 score plus brief reasoning.
 *
 * The judge prompt asks for chain-of-thought *before* the score so it doesn't
 * anchor on a number; output is constrained to a small JSON shape we can parse.
 */
export interface JudgeResult {
  score: number;
  reasoning: string;
  passes: string[];
  fails: string[];
  raw: string;
}

const SYSTEM = `You are a rigorous evaluator scoring an AI assistant's response against a rubric.
Reason carefully BEFORE assigning a score. Reply with a single JSON object — no prose around it — of shape:

{
  "reasoning": "two or three sentences identifying what the response did and did not do, mapped to the rubric",
  "passes": ["short bullet about something the response did right"],
  "fails":  ["short bullet about something it missed or got wrong"],
  "score": <float between 0 and 1>
}

Score 1.0 means the response fully satisfies every clause of the rubric.
Score 0.0 means none of the rubric is met (or the response is empty/wrong).
Be parsimonious — most real responses score between 0.4 and 0.85.`;

export interface JudgeOptions {
  judge: MluxeClient;
  /** Override the system prompt if you need a domain-specific judge. */
  systemPrompt?: string;
  /** Max tokens for the judge's reply. Default 512. */
  maxTokens?: number;
}

export async function runJudge(
  rubric: string,
  userInput: string,
  trajectory: ChatMessage[],
  opts: JudgeOptions,
): Promise<JudgeResult> {
  const assistantText = trajectory
    .filter((m) => m.role === 'assistant' && m.content)
    .map((m) => m.content)
    .join('\n---\n');
  const toolTrace = trajectory
    .filter((m) => m.role === 'tool')
    .map((m) => `tool ${m.name ?? '?'}: ${truncate(m.content, 400)}`)
    .join('\n');

  const userPrompt =
    `RUBRIC:\n${rubric.trim()}\n\n` +
    `USER INPUT:\n${userInput.trim()}\n\n` +
    `ASSISTANT RESPONSE (concatenated turns):\n${assistantText || '(empty)'}` +
    (toolTrace ? `\n\nTOOL TRACE:\n${toolTrace}` : '') +
    `\n\nScore now.`;

  const res = await opts.judge.chat(
    [
      { role: 'system', content: opts.systemPrompt ?? SYSTEM },
      { role: 'user', content: userPrompt },
    ],
    { temperature: 0.0, max_tokens: opts.maxTokens ?? 512 },
  );

  return parseJudgeReply(res.content);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * Lenient JSON extractor. Small local models love to wrap output in ```json
 * fences, prepend "Sure! Here's the JSON:", or trail a closing comment.
 * We grab the largest `{ ... }` substring and parse that.
 */
export function parseJudgeReply(raw: string): JudgeResult {
  const fallback: JudgeResult = {
    score: 0,
    reasoning: 'judge reply did not parse as JSON',
    passes: [],
    fails: [],
    raw,
  };
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    const obj = JSON.parse(match[0]) as Partial<JudgeResult> & { score?: unknown };
    const score = clamp(Number(obj.score), 0, 1);
    return {
      score: Number.isFinite(score) ? score : 0,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      passes: Array.isArray(obj.passes) ? obj.passes.map(String) : [],
      fails: Array.isArray(obj.fails) ? obj.fails.map(String) : [],
      raw,
    };
  } catch {
    return fallback;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
