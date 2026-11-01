import { afterEach, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';

vi.mock('../src/audio/demo', () => ({ createDemoBuffer: () => ({}) }));
afterEach(() => vi.unstubAllGlobals());

it('retains the server measurement ID until the worklet exists and reapplies it to replacement sources', async () => {
  const worklets: { port: { postMessage: ReturnType<typeof vi.fn> } }[] = [];
  class Node {
    connect(node: unknown) { return node; }
    disconnect() {}
  }
  class Source extends Node { start() {} stop() {} }
  class Context {
    state = 'running';
    audioWorklet = { addModule: async () => {} };
    destination = new Node();
    createAnalyser() { return Object.assign(new Node(), { frequencyBinCount: 1 }); }
    createGain() { return Object.assign(new Node(), { gain: { value: 0 } }); }
    createBufferSource() { return new Source(); }
    async resume() {}
    async close() { this.state = 'closed'; }
  }
  vi.stubGlobal('AudioContext', Context);
  vi.stubGlobal('AudioBufferSourceNode', Source);
  vi.stubGlobal('AudioWorkletNode', class extends Node {
    port = { postMessage: vi.fn(), onmessage: null };
    constructor() { super(); worklets.push(this); }
  });
  const engine = new AudioEngine(() => {}, () => {});
  engine.reset('server-round-before-audio-load');
  await engine.demo('balanced');
  expect(worklets[0].port.postMessage).toHaveBeenCalledWith({ type: 'reset', measurementId: 'server-round-before-audio-load' });
  engine.reset('new-server-round');
  await engine.demo('hot');
  expect(worklets[1].port.postMessage).toHaveBeenCalledWith({ type: 'reset', measurementId: 'new-server-round' });
  await engine.stop();
});
