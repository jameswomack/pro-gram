import { describe, expect, it } from 'vitest';
import { diffRuns } from './diff.js';
import type { RunRecord } from './storage.js';

function mk(cases: { id: string; score: number; pass: boolean; tier?: 'unit' | 'property' | 'task' }[]): RunRecord {
  return {
    startedAt: '2026-05-22T00:00:00Z',
    durationMs: 0,
    pack: 'p',
    modelId: 'm',
    tiersRun: ['unit'],
    summary: { unit: undefined, property: undefined, task: undefined },
    cases: cases.map((c) => ({
      tier: c.tier ?? 'unit',
      caseId: c.id,
      score: c.score,
      pass: c.pass,
      durationMs: 0,
      trajectory: [],
    })),
  };
}

describe('diffRuns', () => {
  it('classifies improvements, regressions, new, removed, unchanged', () => {
    const prev = mk([
      { id: 'a', score: 0.5, pass: false },
      { id: 'b', score: 1.0, pass: true },
      { id: 'c', score: 0.8, pass: true },
      { id: 'd', score: 0.6, pass: false },
    ]);
    const curr = mk([
      { id: 'a', score: 1.0, pass: true }, // improved (pass changed)
      { id: 'b', score: 0.4, pass: false }, // regressed
      { id: 'c', score: 0.8, pass: true },  // unchanged
      { id: 'e', score: 0.7, pass: true },  // new
    ]);
    const d = diffRuns(prev, curr);
    const byId = Object.fromEntries(d.deltas.map((x) => [x.caseId, x.status]));
    expect(byId.a).toBe('improved');
    expect(byId.b).toBe('regressed');
    expect(byId.c).toBe('unchanged');
    expect(byId.d).toBe('removed');
    expect(byId.e).toBe('new');
  });

  it('summary tracks tier-level mean and pass count', () => {
    const prev = mk([
      { id: 'a', score: 0.5, pass: false },
      { id: 'b', score: 1.0, pass: true },
    ]);
    const curr = mk([
      { id: 'a', score: 1.0, pass: true },
      { id: 'b', score: 1.0, pass: true },
    ]);
    const d = diffRuns(prev, curr);
    expect(d.summary.unit?.prevMean).toBe(0.75);
    expect(d.summary.unit?.currMean).toBe(1.0);
    expect(d.summary.unit?.prevPassed).toBe(1);
    expect(d.summary.unit?.currPassed).toBe(2);
  });
});
