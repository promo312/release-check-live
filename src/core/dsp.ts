/** Stereo BS.1770 K-weighting, gated energy, and 4x sinc peak estimation.
 * No browser dependencies: the AudioWorklet and numeric tests share this code.
 */
export type Coefficients = [number, number, number, number, number];
export const energyToLufs = (energy: number): number | null => energy > 1e-16 ? -0.691 + 10 * Math.log10(energy) : null;
export const amplitudeToDb = (amplitude: number): number | null => amplitude > 1e-12 ? 20 * Math.log10(amplitude) : null;

export class Biquad {
  private s1 = 0;
  private s2 = 0;
  constructor(public readonly c: Coefficients) {}
  process(x: number): number {
    const [b0, b1, b2, a1, a2] = this.c;
    const y = b0 * x + this.s1;
    this.s1 = b1 * x - a1 * y + this.s2;
    this.s2 = b2 * x - a2 * y;
    return y;
  }
}

export function kWeightingCoefficients(rate: number): [Coefficients, Coefficients] {
  const k = Math.tan(Math.PI * 1681.974450955533 / rate);
  const q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const a = 1 + k / q + k * k;
  const shelf: Coefficients = [
    (vh + vb * k / q + k * k) / a, 2 * (k * k - vh) / a,
    (vh - vb * k / q + k * k) / a, 2 * (k * k - 1) / a, (1 - k / q + k * k) / a,
  ];
  const h = Math.tan(Math.PI * 38.13547087602444 / rate);
  const hq = 0.5003270373238773;
  const ha = 1 + h / hq + h * h;
  return [shelf, [1, -2, 1, 2 * (h * h - 1) / ha, (1 - h / hq + h * h) / ha]];
}

function lowPass(rate: number): Coefficients {
  const w = 2 * Math.PI * 160 / rate;
  const alpha = Math.sin(w) / Math.SQRT2;
  const a = 1 + alpha;
  return [(1 - Math.cos(w)) / (2 * a), (1 - Math.cos(w)) / a,
    (1 - Math.cos(w)) / (2 * a), -2 * Math.cos(w) / a, (1 - alpha) / a];
}

/** 32-tap polyphase Blackman-windowed sinc. One output at each quarter sample.
 * Includes original sample peaks. This is a 4x estimate, not a certification.
 */
export class TruePeak4x {
  private history = new Float64Array(32);
  private index = 0;
  private phases: Float64Array[];
  constructor() {
    this.phases = [0.25, 0.5, 0.75].map(phase => {
      const c = Float64Array.from({ length: 32 }, (_, i) => {
        const x = i - 16 + phase;
        const sinc = Math.abs(x) < 1e-12 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
        const window = 0.42 + 0.5 * Math.cos(Math.PI * x / 16) + 0.08 * Math.cos(2 * Math.PI * x / 16);
        return sinc * window;
      });
      const sum = c.reduce((a, b) => a + b, 0);
      return c.map(v => v / sum);
    });
  }
  process(sample: number): number {
    this.history[this.index] = sample;
    let peak = Math.abs(sample);
    for (const c of this.phases) {
      let y = 0;
      for (let i = 0; i < 32; i++) y += c[i] * this.history[(this.index - i + 32) & 31];
      peak = Math.max(peak, Math.abs(y));
    }
    this.index = (this.index + 1) & 31;
    return peak;
  }
}

/** Absolute -70 LUFS gate, then relative -10 LU gate, on overlapping 400 ms blocks. */
export function integratedLoudness(blocks: readonly number[]): number | null {
  const absolute = blocks.filter(e => (energyToLufs(e) ?? -Infinity) >= -70);
  if (!absolute.length) return null;
  const preliminary = absolute.reduce((a, b) => a + b, 0) / absolute.length;
  const relative = preliminary / 10;
  const gated = absolute.filter(e => e >= relative);
  return energyToLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

interface Slice { k: number; l: number; r: number; cross: number; bass: number; peak: number }
export interface DspReading {
  seconds: number; shortTerm: number | null; momentary: number | null;
  integrated: number | null; truePeak: number | null; peakHold: number | null;
  correlation: number | null; width: number; crest: number; bassRatio: number;
  rms: number | null; left: number | null; right: number | null; balance: number | null; sampleRate: number; clipRatio: number;
}

export class StereoMeter {
  private filters: Biquad[][];
  private lows: Biquad[];
  private peaks = [new TruePeak4x(), new TruePeak4x()];
  private slices: Slice[] = [];
  private blocks: number[] = [];
  private accumulator: Slice = { k: 0, l: 0, r: 0, cross: 0, bass: 0, peak: 0 };
  private count = 0;
  private total = 0;
  private fullScaleSamples = 0;
  private hold = 0;
  private integrated: number | null = null;
  private readonly hop: number;
  constructor(public readonly rate: number) {
    this.hop = Math.round(rate * 0.1);
    this.filters = [0, 1].map(() => kWeightingCoefficients(rate).map(c => new Biquad(c)));
    this.lows = [new Biquad(lowPass(rate)), new Biquad(lowPass(rate))];
  }
  /** Preserve filter history but restart the programme's measurement window. */
  reset() {
    this.slices = []; this.blocks = []; this.count = 0; this.total = 0; this.hold = 0;
    this.integrated = null; this.fullScaleSamples = 0;
    this.accumulator = { k: 0, l: 0, r: 0, cross: 0, bass: 0, peak: 0 };
  }
  process(left: Float32Array, right: Float32Array = left): boolean {
    let updated = false;
    for (let i = 0; i < left.length; i++) {
      const l = Number.isFinite(left[i]) ? left[i] : 0;
      const r = Number.isFinite(right[i]) ? right[i] : 0;
      if (Math.abs(l) >= 1) this.fullScaleSamples++;
      if (Math.abs(r) >= 1) this.fullScaleSamples++;
      const kl = this.filters[0][1].process(this.filters[0][0].process(l));
      const kr = this.filters[1][1].process(this.filters[1][0].process(r));
      const bl = this.lows[0].process(l), br = this.lows[1].process(r);
      this.accumulator.k += kl * kl + kr * kr;
      this.accumulator.l += l * l; this.accumulator.r += r * r;
      this.accumulator.cross += l * r;
      this.accumulator.bass += bl * bl + br * br;
      this.accumulator.peak = Math.max(this.accumulator.peak, this.peaks[0].process(l), this.peaks[1].process(r));
      this.count++; this.total++;
      if (this.count === this.hop) {
        const slice = { ...this.accumulator };
        for (const key of ['k', 'l', 'r', 'cross', 'bass'] as const) slice[key] /= this.hop;
        this.hold = Math.max(this.hold, slice.peak);
        this.slices.push(slice);
        if (this.slices.length > 30) this.slices.shift();
        if (this.slices.length >= 4) {
          this.blocks.push(this.slices.slice(-4).reduce((a, b) => a + b.k, 0) / 4);
          this.integrated = integratedLoudness(this.blocks);
        }
        this.accumulator = { k: 0, l: 0, r: 0, cross: 0, bass: 0, peak: 0 };
        this.count = 0; updated = true;
      }
    }
    return updated;
  }
  read(): DspReading {
    const n = this.slices.length;
    const recent = this.slices.at(-1);
    const average = (key: keyof Slice, values = this.slices) => values.reduce((a, b) => a + b[key], 0) / Math.max(1, values.length);
    const l = average('l'), r = average('r'), cross = average('cross');
    const total = l + r;
    const side = Math.max(0, (total - 2 * cross) / 4);
    const mean = total / 2;
    const correlation = l * r > 1e-20 ? Math.max(-1, Math.min(1, cross / Math.sqrt(l * r))) : null;
    const windowPeak = Math.max(0, ...this.slices.map(s => s.peak));
    return {
      seconds: this.total / this.rate,
      shortTerm: n >= 30 ? energyToLufs(average('k')) : null,
      momentary: n >= 4 ? energyToLufs(average('k', this.slices.slice(-4))) : null,
      integrated: this.integrated,
      truePeak: amplitudeToDb(recent?.peak ?? 0), peakHold: amplitudeToDb(this.hold),
      correlation, width: mean > 1e-16 ? 100 * Math.sqrt(side / mean) : 0,
      crest: mean > 1e-16 ? Math.max(0, 20 * Math.log10(windowPeak / Math.sqrt(mean))) : 0,
      bassRatio: total > 1e-16 ? Math.min(1, average('bass') / total) : 0,
      rms: amplitudeToDb(Math.sqrt(mean)),
      left: amplitudeToDb(Math.sqrt(recent?.l ?? 0)), right: amplitudeToDb(Math.sqrt(recent?.r ?? 0)),
      balance: total > 1e-16 ? Math.max(-60, Math.min(60, 10 * Math.log10(Math.max(l, 1e-16) / Math.max(r, 1e-16)))) : null,
      sampleRate: this.rate,
      clipRatio: this.total ? this.fullScaleSamples / (this.total * 2) : 0,
    };
  }
}
