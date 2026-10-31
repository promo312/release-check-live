import { expect, it } from 'vitest';
import { createDemoBuffer } from '../src/audio/demo';
import { StereoMeter } from '../src/core/dsp';
import { scoreCheck } from '../src/core/scoring';

it.each(['balanced', 'hot', 'phase'] as const)('the %s demo exercises the intended measured result', profile => {
  const context = { sampleRate: 48000, createBuffer: (_: number, length: number, sampleRate: number) => {
    const channels = [new Float32Array(length), new Float32Array(length)];
    return { length, sampleRate, getChannelData: (i: number) => channels[i] };
  } } as unknown as BaseAudioContext;
  const buffer = createDemoBuffer(context, profile), meter = new StereoMeter(48000);
  for (let i = 0; i < 4; i++) meter.process(buffer.getChannelData(0), buffer.getChannelData(1));
  const result = scoreCheck({ ...meter.read(), measurementId: 'test', bands: [] })!;
  if (profile === 'balanced') expect(result.score).toBe(100);
  if (profile === 'hot') expect(result.findings[0].id).toBe('clipping');
  if (profile === 'phase') expect(result.findings[0].id).toBe('phase');
});
