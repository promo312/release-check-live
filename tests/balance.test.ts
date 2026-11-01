import { describe, expect, it } from 'vitest';
import { checkBalance, type BalanceFrame } from '../src/core/balance';
import { scoreCheck } from '../src/core/scoring';
import { goodFrame } from './helpers';

/** 30 s of 100 ms short-term readings; `gap(t)` gives L−R in dB at time t. */
const frames = (gap: (t: number) => number | null): BalanceFrame[] =>
  Array.from({ length: 300 }, (_, i) => ({ seconds: Math.round(i) / 10, gap: gap(i / 10) }));
const during = (from: number, to: number, value: number) => (t: number) => t >= from - 1e-9 && t < to - 1e-9 ? value : 0.5;

describe('stereo balance over the check', () => {
  it('passes a balanced signal', () => {
    expect(checkBalance(frames(() => 0.2))).toBeNull();
    expect(checkBalance([])).toBeNull();
  });
  it('passes a 4 dB gap that lasts 2 s', () => {
    expect(checkBalance(frames(during(10, 12, 4)))).toBeNull();
  });
  it('fails a 4 dB gap that lasts 4 s, with the mean gap and deduction', () => {
    expect(checkBalance(frames(during(10, 14, 4)))).toEqual({ seconds: 4, meanGap: 4, deduction: 16 });
    // Either side, and the mean over the stretch rather than the peak.
    expect(checkBalance(frames(t => t >= 5 && t < 9 ? (t < 7 ? -4 : -5) : 0))).toMatchObject({ meanGap: 4.5, deduction: 16.5 });
  });
  it('passes a gap that flickers above and below 3 dB', () => {
    expect(checkBalance(frames(t => Math.round(t * 10) % 20 < 15 ? 4 : 2.5))).toBeNull();
  });
  it('treats a missing reading as the end of a stretch and caps the deduction', () => {
    expect(checkBalance(frames(t => t >= 10 && t < 12 ? 6 : t < 12.5 ? null : t < 14 ? 6 : 0))).toBeNull();
    expect(checkBalance(frames(t => t >= 20 ? 40 : 0))!.deduction).toBe(25);
  });
});

describe('balance in the score', () => {
  it('deducts and leads with the exact top issue text', () => {
    const result = scoreCheck(goodFrame(), 1, 'original', frames(during(10, 14, 4)))!;
    expect(result.score).toBe(84);
    expect(result.topIssue).toBe('Stereo balance off: left/right differ by 4.0 dB');
    expect(result.findings[0].id).toBe('balance');
  });
  it('stays the top issue even when another finding deducts more', () => {
    const result = scoreCheck(goodFrame({ clipRatio: 0.01 }), 1, 'original', frames(during(10, 14, 4)))!;
    expect(result.findings.map(f => f.id)).toEqual(['balance', 'clipping']);
    expect(result.score).toBe(49);
  });
});
