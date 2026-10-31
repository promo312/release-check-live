import type { CheckResult, Finding, MasterPreset, MeterFrame } from './types';

export const TARGET = { lufs: -14, tolerance: 2, peak: -1, minCrest: 6 };
const round = (n: number) => Math.round(n * 10) / 10;

/** House preferences, not a release certification. Audience votes never change this score. */
export function scoreCheck(meters: MeterFrame, checkedAt = Date.now(), preset: MasterPreset = 'original'): CheckResult | null {
  if (meters.seconds < 28 || meters.integrated === null || meters.integrated < -60 || meters.peakHold === null) return null;
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);
  if (meters.clipRatio > 0) add({
    id: 'clipping', title: 'Clipping: samples reached full scale',
    detail: `${round(meters.clipRatio * 100)}% of measured channel samples reached full scale.`,
    fix: `${preset === 'hot' ? 'Switch back to Original to remove the added +6 dB and hard clipping. ' : ''}Reduce gain before the output stage and set a true-peak limiter ceiling to −1 dBTP or below. Turning down an already clipped file cannot restore its peaks.`,
    deduction: 35,
  });
  else if (meters.peakHold > TARGET.peak) add({
    id: 'peak', title: 'Leave more peak headroom',
    detail: `True peak reached ${round(meters.peakHold)} dBTP. The check target is −1 dBTP.`,
    fix: `Lower the output ceiling to −1 dBTP or below, then reduce input gain by about ${Math.max(0.5, round(meters.peakHold + 1))} dB and check again.`,
    deduction: Math.min(35, 15 + 10 * (meters.peakHold + 1)),
  });
  const distance = Math.abs(meters.integrated - TARGET.lufs) - TARGET.tolerance;
  if (distance > 0) add({
    id: 'loudness', title: meters.integrated > -14 ? 'Loudness is above the target' : 'Loudness is below the target',
    detail: `${round(meters.integrated)} LUFS integrated; this check uses −14 ±2 LU as a listening preference.`,
    fix: meters.integrated > -14 ? 'Ease the limiter input or output gain toward −14 LUFS. Compare at matched loudness before changing dynamics.' : 'Raise the output gain toward −14 LUFS while keeping true peak at or below −1 dBTP.',
    deduction: Math.min(25, distance * 5),
  });
  if (meters.correlation !== null && meters.correlation < 0) add({
    id: 'phase', title: 'Check the mix in mono',
    detail: `Stereo correlation is ${round(meters.correlation)}. Some elements may cancel when summed.`,
    fix: 'Listen in mono. Narrow the widest element, check channel polarity, and keep the low frequencies centered.',
    deduction: Math.min(25, 10 + Math.abs(meters.correlation) * 15),
  });
  if (meters.crest < TARGET.minCrest) add({
    id: 'dynamics', title: 'Give the transients some room',
    detail: `The final 3-second crest factor is ${round(meters.crest)} dB, below the 6 dB check preference.`,
    fix: 'Reduce limiting or bus compression and compare the punch at matched loudness.',
    deduction: Math.min(15, (TARGET.minCrest - meters.crest) * 3),
  });
  findings.sort((a, b) => b.deduction - a.deduction);
  const score = Math.max(0, Math.min(100, Math.round(100 - findings.reduce((a, b) => a + b.deduction, 0))));
  return {
    score, label: score >= 85 ? 'In good shape' : score >= 65 ? 'A little more care' : 'Room to refine', findings,
    topIssue: findings[0]?.title ?? 'The measured checks are in range',
    fix: findings[0]?.fix ?? 'Compare with a reference at matched loudness, listen in mono, and check the full track before deciding.',
    meters, checkedAt,
  };
}
