import type { DemoProfile } from '../core/types';

/** Original deterministic synthesis: no samples, licensed recordings, or network requests. */
export function createDemoBuffer(context: BaseAudioContext, profile: DemoProfile): AudioBuffer {
  const rate = context.sampleRate;
  const beat = 60 / 112;
  const duration = beat * 16;
  const length = Math.round(duration * rate);
  const buffer = context.createBuffer(2, length, rate);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  let seed = 98421;
  const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed / 2147483648; };
  const notes = [55, 55, 65.406, 49];
  let power = 0;
  for (let i = 0; i < length; i++) {
    const t = i / rate;
    const b = t / beat;
    const kickTime = (b % 1) * beat;
    const kick = Math.sin(2 * Math.PI * (47 * kickTime + 7 * (1 - Math.exp(-kickTime * 32)))) * Math.exp(-kickTime * 19) * 0.9;
    const hatTime = (b % 0.5) * beat;
    const hat = noise() * Math.exp(-hatTime * 95) * 0.17;
    const snareTime = ((b + 1) % 2) * beat;
    const snare = noise() * Math.exp(-snareTime * 29) * 0.3;
    const bar = Math.floor(b / 4) % 4;
    const bass = Math.sin(2 * Math.PI * notes[bar] * t) * 0.19 * (1 - Math.exp(-kickTime * 24));
    const melodyTime = (b % 0.5) * beat;
    const melody = Math.sin(2 * Math.PI * notes[bar] * [8, 12, 10, 16][Math.floor(b * 2) % 4] * t) * Math.exp(-melodyTime * 8) * 0.09;
    const center = kick + bass + snare;
    left[i] = center + hat + melody;
    right[i] = center + hat * 0.65 + melody * Math.cos(t * 1.7) + Math.sin(2 * Math.PI * 330 * t) * 0.025;
    power += (left[i] ** 2 + right[i] ** 2) / 2;
  }
  const gain = 0.128 / Math.sqrt(power / length);
  for (let i = 0; i < length; i++) {
    const l = left[i] * gain, r = right[i] * gain;
    left[i] = Math.tanh(l * 1.8) * 0.8;
    right[i] = Math.tanh(r * 1.8) * 0.8;
    if (profile === 'hot') {
      left[i] = Math.tanh(l * 6) * 1.02;
      right[i] = Math.tanh(r * 6) * 1.02;
    }
    if (profile === 'phase') right[i] = -left[i] * 0.94;
  }
  return buffer;
}
