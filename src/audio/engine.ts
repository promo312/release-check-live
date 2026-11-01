import workletUrl from './meter.worklet.ts?worker&url';
import { createDemoBuffer } from './demo';
import type { DemoProfile, MasterPreset, MeterFrame } from '../core/types';

export class AudioEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private source: AudioBufferSourceNode | MediaStreamAudioSourceNode | null = null;
  private media: MediaStream | null = null;
  private monitor: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencyData: Float32Array<ArrayBuffer> | null = null;
  private isInput = false;
  private intentionalPause = false;
  private measurementId = 'monitor';
  monitoring = false;
  preset: MasterPreset = 'original';

  get loaded() { return this.source !== null; }
  get playing() { return this.loaded && this.context?.state === 'running'; }
  get muted() { return !this.monitoring; }

  constructor(private onMeters: (frame: MeterFrame) => void, private onSuspended: () => void) {}

  private async prepare(isInput = false) {
    await this.stop();
    this.isInput = isInput;
    this.intentionalPause = false;
    this.preset = 'original';
    const context = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
    this.context = context;
    await context.audioWorklet.addModule(workletUrl);
    this.worklet = new AudioWorkletNode(context, 'release-meter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit' });
    // State can arrive while the source is still decoding or the module loads.
    this.reset(this.measurementId);
    this.analyser = context.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.75;
    this.frequencyData = new Float32Array(this.analyser.frequencyBinCount);
    this.monitor = context.createGain();
    this.monitoring = !isInput;
    this.monitor.gain.value = this.monitoring ? 0.55 : 0;
    this.worklet.connect(this.analyser).connect(this.monitor).connect(context.destination);
    this.worklet.port.onmessage = event => {
      const frame = event.data as MeterFrame;
      frame.bands = this.spectrum();
      this.onMeters(frame);
    };
    context.onstatechange = () => {
      if (context.state === 'suspended' && !this.intentionalPause) this.onSuspended();
    };
    await context.resume();
    return context;
  }

  async demo(profile: DemoProfile) {
    try {
      const context = await this.prepare();
      const source = context.createBufferSource();
      source.buffer = createDemoBuffer(context, profile);
      source.loop = true;
      source.connect(this.worklet!); source.start();
      this.source = source;
    } catch (error) { await this.stop(); throw error; }
  }

  async file(file: File) {
    try {
      const context = await this.prepare();
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      const source = context.createBufferSource();
      source.buffer = buffer; source.loop = true;
      source.connect(this.worklet!); source.start();
      this.source = source;
    } catch (error) { await this.stop(); throw error; }
  }

  async input(deviceId?: string) {
    try {
      const context = await this.prepare(true);
      this.media = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      }, video: false });
      this.media.getAudioTracks().forEach(track => track.onended = () => { void this.stop().then(this.onSuspended); });
      this.source = context.createMediaStreamSource(this.media);
      this.source.connect(this.worklet!);
    } catch (error) { await this.stop(); throw error; }
  }

  async pause() {
    if (!this.context || !this.playing) return;
    this.intentionalPause = true;
    await this.context.suspend();
  }

  async play() {
    if (!this.context || !this.loaded) return;
    await this.context.resume();
    this.intentionalPause = false;
  }

  setPreset(preset: MasterPreset) {
    if (!this.loaded || this.isInput) return;
    this.preset = preset;
    this.worklet?.port.postMessage({ type: 'preset', preset });
  }

  reset(measurementId: string) {
    this.measurementId = measurementId;
    this.worklet?.port.postMessage({ type: 'reset', measurementId });
  }
  toggleMonitor(): boolean {
    if (!this.monitor || !this.context || this.isInput) return false;
    this.monitoring = !this.monitoring;
    // The icon and the actual output gain change together, including while paused.
    this.monitor.gain.value = this.monitoring ? 0.55 : 0;
    return this.monitoring;
  }
  private spectrum(): number[] {
    if (!this.analyser || !this.frequencyData || !this.context) return [];
    this.analyser.getFloatFrequencyData(this.frequencyData);
    const binHz = this.context.sampleRate / this.analyser.fftSize;
    return Array.from({ length: 56 }, (_, i) => {
      const low = Math.floor(35 * (16000 / 35) ** (i / 56) / binHz);
      const high = Math.max(low + 1, Math.floor(35 * (16000 / 35) ** ((i + 1) / 56) / binHz));
      let max = -100;
      for (let k = low; k < Math.min(high, this.frequencyData!.length); k++) max = Math.max(max, this.frequencyData![k]);
      return Math.max(0, Math.min(1, (max + 85) / 75));
    });
  }
  async stop() {
    if (this.source instanceof AudioBufferSourceNode) this.source.stop();
    this.source?.disconnect(); this.source = null;
    this.media?.getTracks().forEach(t => { t.onended = null; t.stop(); }); this.media = null;
    this.worklet?.disconnect(); this.worklet = null;
    const context = this.context;
    this.context = null; this.analyser = null; this.monitor = null; this.monitoring = false;
    if (context) { context.onstatechange = null; await context.close(); }
  }
}
