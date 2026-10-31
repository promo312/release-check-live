import { StereoMeter } from '../core/dsp';
import { masterSample } from './master';
import type { MasterPreset } from '../core/types';

declare const sampleRate: number;
declare class AudioWorkletProcessor { port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class MeterProcessor extends AudioWorkletProcessor {
  private meter = new StereoMeter(sampleRate);
  private measurementId = 'monitor';
  private preset: MasterPreset = 'original';
  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'preset') this.preset = event.data.preset === 'hot' ? 'hot' : 'original';
      if (event.data.type === 'reset') {
        this.measurementId = event.data.measurementId;
        this.meter.reset();
      }
    };
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (input?.[0]) {
      const left = outputs[0][0], right = outputs[0][1];
      for (let i = 0; i < left.length; i++) {
        left[i] = masterSample(input[0][i], this.preset);
        right[i] = masterSample((input[1] ?? input[0])[i], this.preset);
      }
      if (this.meter.process(left, right)) this.port.postMessage({ ...this.meter.read(), measurementId: this.measurementId });
    }
    return true;
  }
}
registerProcessor('release-meter', MeterProcessor);
