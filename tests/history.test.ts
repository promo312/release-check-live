import { describe, expect, it } from 'vitest';
import { historyLabel } from '../src/core/history';

const at = new Date(2026, 10, 1, 11, 34).getTime();

describe('history label', () => {
  it('formats the source, loudness, true peak and time with a real minus sign', () => {
    expect(historyLabel({ time: at, source: 'After hours / Balanced mix', integrated: -13.84, truePeak: -1.4 }))
      .toBe('After hours / Balanced mix · −13.8 LUFS · −1.4 dBTP · 11:34');
    expect(historyLabel({ time: at, source: 'Live input', integrated: -9, truePeak: 0.3 })).toBe('Live input · −9.0 LUFS · 0.3 dBTP · 11:34');
    expect(historyLabel({ time: new Date(2026, 10, 1, 0, 5).getTime(), source: '', integrated: -14, truePeak: -1 })).toBe('Live input · −14.0 LUFS · −1.0 dBTP · 00:05');
  });
  it('still renders entries saved before these fields existed', () => {
    expect(historyLabel({ time: at })).toBe('11:34');
    expect(historyLabel({ time: at, source: 'Mix.wav', integrated: null, truePeak: null })).toBe('Mix.wav · 11:34');
  });
});
