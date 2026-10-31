import type { MasterPreset } from '../core/types';

export const HOT_MASTER_GAIN = 10 ** (6 / 20);

/** Apply to playback samples, never to the decoded buffer or the user's file. */
export function masterSample(sample: number, preset: MasterPreset): number {
  return preset === 'hot' ? Math.max(-1, Math.min(1, sample * HOT_MASTER_GAIN)) : sample;
}
