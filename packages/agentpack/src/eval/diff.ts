import type { CaseResult, RunRecord, Tier } from './storage.js';

export interface CaseDelta {
  caseId: string;
  tier: Tier;
  prevScore?: number;
  currScore: number;
  prevPass?: boolean;
  currPass: boolean;
  /** 'improved' | 'regressed' | 'unchanged' | 'new' | 'removed' */
  status: 'improved' | 'regressed' | 'unchanged' | 'new' | 'removed';
}

export interface RunDiff {
  prev: { startedAt: string; modelId: string };
  curr: { startedAt: string; modelId: string };
  deltas: CaseDelta[];
  /** Summary by tier of how the pass/total + mean score moved. */
  summary: Record<Tier, { prevMean: number; currMean: number; prevPassed: number; currPassed: number; n: number } | undefined>;
}

const EPSILON = 0.01;

/**
 * Compute the diff between two runs of the same pack. Cases are matched by
 * `caseId`. Unchanged-status cases still appear in the result (so callers can
 * render full tables); filter them out at the render layer if you only want
 * the deltas.
 */
export function diffRuns(prev: RunRecord, curr: RunRecord): RunDiff {
  const prevById = new Map(prev.cases.map((c) => [c.caseId, c] as const));
  const currById = new Map(curr.cases.map((c) => [c.caseId, c] as const));
  const allIds = new Set<string>([...prevById.keys(), ...currById.keys()]);

  const deltas: CaseDelta[] = [];
  for (const id of allIds) {
    const p = prevById.get(id);
    const c = currById.get(id);
    if (c && !p) {
      deltas.push({ caseId: id, tier: c.tier, currScore: c.score, currPass: c.pass, status: 'new' });
      continue;
    }
    if (p && !c) {
      deltas.push({ caseId: id, tier: p.tier, prevScore: p.score, currScore: 0, prevPass: p.pass, currPass: false, status: 'removed' });
      continue;
    }
    if (p && c) {
      const dScore = c.score - p.score;
      const passChanged = p.pass !== c.pass;
      let status: CaseDelta['status'];
      if (passChanged) status = c.pass ? 'improved' : 'regressed';
      else if (dScore > EPSILON) status = 'improved';
      else if (dScore < -EPSILON) status = 'regressed';
      else status = 'unchanged';
      deltas.push({
        caseId: id,
        tier: c.tier,
        prevScore: p.score,
        currScore: c.score,
        prevPass: p.pass,
        currPass: c.pass,
        status,
      });
    }
  }

  deltas.sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.caseId.localeCompare(b.caseId));

  const summary: RunDiff['summary'] = { unit: undefined, property: undefined, task: undefined };
  for (const tier of ['unit', 'property', 'task'] as const) {
    const prevCases = prev.cases.filter((c) => c.tier === tier);
    const currCases = curr.cases.filter((c) => c.tier === tier);
    if (prevCases.length === 0 && currCases.length === 0) continue;
    summary[tier] = {
      prevMean: mean(prevCases),
      currMean: mean(currCases),
      prevPassed: prevCases.filter((c) => c.pass).length,
      currPassed: currCases.filter((c) => c.pass).length,
      n: Math.max(prevCases.length, currCases.length),
    };
  }

  return {
    prev: { startedAt: prev.startedAt, modelId: prev.modelId },
    curr: { startedAt: curr.startedAt, modelId: curr.modelId },
    deltas,
    summary,
  };
}

function statusRank(s: CaseDelta['status']): number {
  return { regressed: 0, improved: 1, new: 2, removed: 3, unchanged: 4 }[s];
}

function mean(cs: CaseResult[]): number {
  if (cs.length === 0) return 0;
  return cs.reduce((s, c) => s + c.score, 0) / cs.length;
}
