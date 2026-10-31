import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { amplitudeToDb, integratedLoudness, kWeightingCoefficients, StereoMeter, TruePeak4x } from '../src/core/dsp';
import { sine } from './helpers';

describe('BS.1770 energy and stereo measurements', () => {
  it('matches the published 48 kHz K-weighting coefficients', () => {
    const [shelf, highpass] = kWeightingCoefficients(48000);
    const expected = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
    expected.forEach((v, i) => expect(shelf[i]).toBeCloseTo(v, 10));
    expect(highpass[3]).toBeCloseTo(-1.99004745483398, 10);
    expect(highpass[4]).toBeCloseTo(0.99007225036621, 10);
  });
  it.each([44100, 48000, 96000])('reads a stereo 1 kHz −23 dBFS sine near −23 LUFS at %i Hz', rate => {
    const meter = new StereoMeter(rate);
    const input = sine(rate, 3.2);
    // Exercise real worklet-size boundaries rather than aligned 100 ms packets.
    for (let i = 0; i < input.length; i += 128) meter.process(input.subarray(i, i + 128));
    expect(meter.read().integrated!).toBeCloseTo(-23, 1);
    expect(meter.read().shortTerm!).toBeCloseTo(-23, 1);
    expect(meter.read().peakHold!).toBeCloseTo(-23, 1);
  });
  it('does not invent loudness for silence or a short warmup', () => {
    const meter = new StereoMeter(48000); meter.process(new Float32Array(192000));
    expect(meter.read().integrated).toBeNull(); expect(meter.read().shortTerm).toBeNull();
    expect(meter.read().peakHold).toBeNull(); expect(meter.read().width).toBe(0);
    meter.process(sine(48000, 0.1)); meter.reset();
    expect(meter.read().integrated).toBeNull(); expect(meter.read().seconds).toBe(0);
  });
  it('applies absolute and relative gates in energy, and preserves loudness through a quiet gap', () => {
    const loud = 10 ** ((-23 + 0.691) / 10), quiet = 10 ** ((-55 + 0.691) / 10);
    expect(integratedLoudness([0, 1e-12])).toBeNull();
    expect(integratedLoudness([loud, loud, quiet, quiet, 0])!).toBeCloseTo(-23, 8);
  });
  it('distinguishes mono-compatible stereo from opposite polarity', () => {
    const input = sine(48000, 0.5);
    const mono = new StereoMeter(48000); mono.process(input, input);
    expect(mono.read().correlation).toBeCloseTo(1); expect(mono.read().width).toBeCloseTo(0);
    const inverse = new StereoMeter(48000); inverse.process(input, input.map(v => -v));
    expect(inverse.read().correlation).toBeCloseTo(-1); expect(inverse.read().width).toBeCloseTo(100);
  });
});

describe('4× true-peak reconstruction', () => {
  it('detects a 3 dB intersample overshoot that a sample meter misses', () => {
    const estimator = new TruePeak4x();
    const input = sine(48000, 0.15, 12000, 1, Math.PI / 4);
    let peak = 0, samplePeak = 0;
    input.forEach((x, i) => { const value = estimator.process(x); if (i > 100) { peak = Math.max(peak, value); samplePeak = Math.max(samplePeak, Math.abs(x)); } });
    expect(amplitudeToDb(samplePeak)!).toBeCloseTo(-3.0103, 3);
    expect(amplitudeToDb(peak)!).toBeCloseTo(0, 1);
    expect(peak).toBeGreaterThan(samplePeak * 1.4);
  });
});

let ffmpegAvailable = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpegAvailable = false; }
describe.skipIf(!ffmpegAvailable)('independent FFmpeg ebur128 reference', () => {
  it.each([44100, 48000])('matches a multitone reference within 0.2 LU at %i Hz', rate => {
    const duration = 4;
    const left = Float32Array.from({ length: rate * duration }, (_, i) => {
      const t = i / rate;
      return 0.09 * Math.sin(2 * Math.PI * 60 * t) + 0.075 * Math.sin(2 * Math.PI * 997 * t) + 0.025 * Math.sin(2 * Math.PI * 8000 * t);
    });
    const right = Float32Array.from(left, (v, i) => 0.8 * v + 0.03 * Math.sin(2 * Math.PI * 330 * i / rate));
    const meter = new StereoMeter(rate); meter.process(left, right);
    const interleaved = new Float32Array(left.length * 2);
    left.forEach((v, i) => { interleaved[2 * i] = v; interleaved[2 * i + 1] = right[i]; });
    const dir = mkdtempSync(path.join(os.tmpdir(), 'release-meter-test-'));
    try {
      const file = path.join(dir, 'signal.f32'); writeFileSync(file, Buffer.from(interleaved.buffer));
      const output = requireReference(file, rate);
      const integrated = [...output.matchAll(/I:\s*(-?[\d.]+) LUFS/g)].at(-1);
      const peak = [...output.matchAll(/Peak:\s*(-?[\d.]+) dBFS/g)].at(-1);
      expect(integrated).toBeTruthy();
      expect(Math.abs(meter.read().integrated! - Number(integrated![1]))).toBeLessThan(0.2);
      expect(Math.abs(meter.read().peakHold! - Number(peak![1]))).toBeLessThan(0.4);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

import { spawnSync } from 'node:child_process';
function requireReference(file: string, rate: number) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-f', 'f32le', '-ar', String(rate), '-ac', '2', '-i', file, '-filter:a', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('FFmpeg reference execution failed');
  return result.stderr;
}
