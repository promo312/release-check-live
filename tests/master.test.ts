import { describe, expect, it } from 'vitest';
import { HOT_MASTER_GAIN, masterSample } from '../src/audio/master';
import { createDemoBuffer } from '../src/audio/demo';
import { StereoMeter } from '../src/core/dsp';
import { scoreCheck } from '../src/core/scoring';
import type { MasterPreset } from '../src/core/types';

describe('Hot master playback preset', () => {
  it('adds exactly +6 dB, hard clips both polarities, and leaves Original unchanged', () => {
    expect(20 * Math.log10(HOT_MASTER_GAIN)).toBeCloseTo(6, 12);
    expect(masterSample(0.1, 'hot')).toBeCloseTo(0.1 * HOT_MASTER_GAIN, 12);
    expect(masterSample(0.8, 'hot')).toBe(1); expect(masterSample(-0.8, 'hot')).toBe(-1);
    expect(masterSample(0.8, 'original')).toBe(0.8);
  });
  it('measures real clipping and a lower score on the same original buffer, without altering it', () => {
    const channels: Float32Array[] = [];
    const context = { sampleRate: 48000, createBuffer: (_: number, length: number, sampleRate: number) => {
      channels.push(new Float32Array(length), new Float32Array(length));
      return { length, sampleRate, getChannelData: (i: number) => channels[i] };
    } } as unknown as BaseAudioContext;
    const buffer = createDemoBuffer(context, 'balanced');
    const copy = channels.map(channel => channel.slice());
    const measure = (preset: MasterPreset) => {
      const meter = new StereoMeter(48000);
      const l = buffer.getChannelData(0).map(x => masterSample(x, preset));
      const r = buffer.getChannelData(1).map(x => masterSample(x, preset));
      for (let i = 0; i < 4; i++) meter.process(l, r);
      return scoreCheck({ ...meter.read(), measurementId: 'test', bands: [] }, 1, preset)!;
    };
    const original = measure('original'), hot = measure('hot');
    expect(original.score).toBe(100); expect(original.meters.clipRatio).toBe(0);
    expect(hot.score).toBeLessThanOrEqual(65); expect(hot.meters.clipRatio).toBeGreaterThan(0);
    expect(hot.findings[0].id).toBe('clipping'); expect(hot.fix).toContain('Switch back to Original');
    expect(Buffer.from(channels[0].buffer).equals(Buffer.from(copy[0].buffer))).toBe(true);
    expect(Buffer.from(channels[1].buffer).equals(Buffer.from(copy[1].buffer))).toBe(true);
    const quiet = masterSample(0.05, 'hot'); expect(quiet).toBeLessThan(1); // No invented clipping for a quiet source.
  });
});
