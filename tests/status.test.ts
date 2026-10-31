import { describe, expect, it } from 'vitest';
import { audioStatus, chatStatus } from '../src/ui/status';
import type { AudioDetails, AudioSourceKind } from '../src/core/types';

const details = (kind: AudioSourceKind, paused = false): AudioDetails => ({ kind, preset: 'original', paused, muted: false });
describe('honest status labels', () => {
  it('identifies local file analysis and a paused file without claiming a live connection', () => {
    expect(audioStatus({ audioActive: true, audioDetails: details('file') }, true)).toBe('Analyzing local track');
    expect(audioStatus({ audioActive: false, audioDetails: details('file', true) }, true)).toBe('Local track paused');
    expect(audioStatus({ audioActive: true, audioDetails: details('demo') }, true)).toBe('Analyzing demo audio');
    expect(audioStatus({ audioActive: true, audioDetails: details('input') }, true)).toBe('Analyzing audio input');
  });
  it('labels simulated chat even when a stale status says connected', () => {
    expect(chatStatus({ mode: 'demo', twitchStatus: 'demo' }, true)).toBe('Demo chat');
    expect(chatStatus({ mode: 'demo', twitchStatus: 'connected' }, true)).toBe('Demo chat');
  });
  it('shows Live on Twitch after connection, never while connecting, failed, or locally disconnected', () => {
    expect(chatStatus({ mode: 'twitch', twitchStatus: 'connected' }, true)).toBe('Live on Twitch');
    expect(chatStatus({ mode: 'twitch', twitchStatus: 'connecting' }, true)).toBe('Twitch connecting');
    expect(chatStatus({ mode: 'twitch', twitchStatus: 'error' }, true)).toBe('Twitch setup needed');
    expect(chatStatus({ mode: 'twitch', twitchStatus: 'connected' }, false)).toBe('Chat disconnected');
  });
});
