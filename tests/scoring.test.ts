import { describe, expect, it } from 'vitest';
import { scoreCheck } from '../src/core/scoring';
import { goodFrame } from './helpers';

describe('transparent house preferences', () => {
  it('scores an in-range signal at 100, with no invented issue', () => {
    const result = scoreCheck(goodFrame(), 123)!;
    expect(result.score).toBe(100); expect(result.findings).toEqual([]); expect(result.checkedAt).toBe(123);
  });
  it('refuses insufficient or silent material', () => {
    expect(scoreCheck(goodFrame({ seconds: 2 }))).toBeNull();
    expect(scoreCheck(goodFrame({ integrated: null }))).toBeNull();
    expect(scoreCheck(goodFrame({ integrated: -65 }))).toBeNull();
  });
  it('ranks the largest deduction and clamps the score', () => {
    const result = scoreCheck(goodFrame({ integrated: -5, peakHold: 2, correlation: -1, crest: 0 }))!;
    expect(result.score).toBe(0); expect(result.findings[0].id).toBe('peak');
    expect(result.fix).toContain('−1 dBTP');
    expect(result.findings.map(f => f.id)).toContain('phase');
  });
  it('does not infer a tonal problem from a bass ratio', () => {
    expect(scoreCheck(goodFrame({ bassRatio: 0 }))!.score).toBe(100);
  });
  it('reduces the score with excess loudness or inverted stereo', () => {
    expect(scoreCheck(goodFrame({ integrated: -10 }))!.score).toBe(90);
    expect(scoreCheck(goodFrame({ correlation: -1 }))!.score).toBe(75);
  });
});
