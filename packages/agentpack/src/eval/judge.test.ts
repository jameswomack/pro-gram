import { describe, expect, it } from 'vitest';
import { parseJudgeReply } from './judge.js';

describe('parseJudgeReply', () => {
  it('parses a clean JSON object', () => {
    const r = parseJudgeReply('{"reasoning":"ok","passes":["a"],"fails":[],"score":0.8}');
    expect(r.score).toBe(0.8);
    expect(r.passes).toEqual(['a']);
  });
  it('strips a code-fence wrapper', () => {
    const r = parseJudgeReply('```json\n{"reasoning":"x","passes":[],"fails":[],"score":0.4}\n```');
    expect(r.score).toBe(0.4);
  });
  it('extracts JSON from prose around it', () => {
    const r = parseJudgeReply('Sure! {"reasoning":"hm","passes":[],"fails":["bad"],"score":0.2} — done.');
    expect(r.score).toBe(0.2);
    expect(r.fails).toEqual(['bad']);
  });
  it('clamps out-of-range scores', () => {
    const r = parseJudgeReply('{"reasoning":"","passes":[],"fails":[],"score":1.7}');
    expect(r.score).toBe(1);
  });
  it('returns 0 on garbage', () => {
    const r = parseJudgeReply('no json here whatsoever');
    expect(r.score).toBe(0);
    expect(r.reasoning).toMatch(/did not parse/);
  });
});
