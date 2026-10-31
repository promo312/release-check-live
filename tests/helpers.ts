import type { MeterFrame } from '../src/core/types';
export const goodFrame = (overrides: Partial<MeterFrame> = {}): MeterFrame => ({
  measurementId: 'monitor', seconds: 30, shortTerm: -14, momentary: -14, integrated: -14,
  truePeak: -2, peakHold: -2, correlation: 0.8, width: 32, crest: 12, bassRatio: 0.25,
  rms: -17, left: -17, right: -17, bands: [0.5], sampleRate: 48000, clipRatio: 0, ...overrides,
});

export function sine(rate: number, seconds: number, frequency = 1000, amplitude = 10 ** (-23 / 20), phase = 0): Float32Array {
  return Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate + phase));
}
