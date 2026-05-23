import { z } from 'zod';

/**
 * Schemas for the three eval file shapes a pack can ship. All three live under
 * `<pack>/evals/` and are picked up by id (`cases.yaml`, `properties.yaml`,
 * `tasks.yaml`). All three are optional — a pack with zero evals is allowed.
 */

// ── Tier 1: unit cases ────────────────────────────────────────────────────────
//
// Single-turn input → structural assertions on the model's reply.
//
//   - id: knows-wOBA
//     input: "What's a good measure of overall hitting value?"
//     maxTokens: 256   # optional per-case override; default 256 (cheap tier 1)
//     asserts:
//       - finalContains: "wOBA"
//       - notContains: "best stat is batting average"

const AssertionSchema = z.union([
  z.object({ contains: z.string() }),
  z.object({ notContains: z.string() }),
  z.object({ finalContains: z.string() }),
  z.object({ finalNotContains: z.string() }),
  z.object({ regex: z.string(), flags: z.string().optional() }),
  z.object({ toolCalled: z.string() }),
  z.object({ toolNotCalled: z.string() }),
  z.object({
    toolArgsContain: z.object({
      tool: z.string(),
      args: z.record(z.unknown()),
    }),
  }),
  z.object({ minAssistantTurns: z.number().int().positive() }),
]);

export const UnitCaseSchema = z.object({
  id: z.string(),
  input: z.string(),
  maxTokens: z.number().int().positive().default(256),
  asserts: z.array(AssertionSchema).default([]),
});

export const UnitCaseFileSchema = z.object({
  cases: z.array(UnitCaseSchema).default([]),
});

// ── Tier 2: property checks (LLM-as-judge) ───────────────────────────────────

export const PropertyCaseSchema = z.object({
  id: z.string(),
  input: z.string(),
  rubric: z.string(),
  /** Pass threshold on a 0–1 judge score. Default 0.7. */
  threshold: z.number().min(0).max(1).default(0.7),
  maxTokens: z.number().int().positive().default(512),
});

export const PropertyFileSchema = z.object({
  properties: z.array(PropertyCaseSchema).default([]),
});

// ── Tier 3: multi-turn task evals ────────────────────────────────────────────

export const TaskStepSchema = z.object({
  user: z.string(),
});

export const TaskCaseSchema = z.object({
  id: z.string(),
  steps: z.array(TaskStepSchema).min(1),
  rubric: z.string(),
  threshold: z.number().min(0).max(1).default(0.7),
  maxTokens: z.number().int().positive().default(768),
});

export const TaskFileSchema = z.object({
  tasks: z.array(TaskCaseSchema).default([]),
});

// ── Inferred types ────────────────────────────────────────────────────────────

export type Assertion = z.infer<typeof AssertionSchema>;
export type UnitCase = z.infer<typeof UnitCaseSchema>;
export type UnitCaseFile = z.infer<typeof UnitCaseFileSchema>;
export type PropertyCase = z.infer<typeof PropertyCaseSchema>;
export type PropertyFile = z.infer<typeof PropertyFileSchema>;
export type TaskStep = z.infer<typeof TaskStepSchema>;
export type TaskCase = z.infer<typeof TaskCaseSchema>;
export type TaskFile = z.infer<typeof TaskFileSchema>;
