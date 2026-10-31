import type { SessionState } from '../core/types';

type AudioState = Pick<SessionState, 'audioActive' | 'audioDetails'>;
type ChatState = Pick<SessionState, 'mode' | 'twitchStatus'>;

export function audioStatus(state: AudioState, connected: boolean): string {
  if (!connected) return 'Audio disconnected';
  if (state.audioDetails.paused) return state.audioDetails.kind === 'file' ? 'Local track paused' : 'Playback paused';
  if (!state.audioActive) return 'Choose audio';
  return { file: 'Analyzing local track', demo: 'Analyzing demo audio', input: 'Analyzing audio input' }[state.audioDetails.kind];
}

export function chatStatus(state: ChatState, connected: boolean): string {
  if (!connected) return 'Chat disconnected';
  if (state.mode === 'demo') return 'Demo chat';
  return state.twitchStatus === 'connected' ? 'Live on Twitch' : state.twitchStatus === 'error' ? 'Twitch setup needed' : 'Twitch connecting';
}
