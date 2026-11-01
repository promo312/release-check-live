import type { HistoryEntry } from './types';

const signed = (n: number) => n.toFixed(1).replace('-', '−');
const clock = (time: number) => {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** "<track or Live input> · −13.8 LUFS · −1.4 dBTP · 11:34". Entries saved before these
 * fields existed omit the missing parts. */
export function historyLabel(entry: Pick<HistoryEntry, 'time' | 'source' | 'integrated' | 'truePeak'>): string {
  const parts: string[] = [];
  if (entry.source !== undefined) parts.push(entry.source.trim() || 'Live input');
  if (typeof entry.integrated === 'number') parts.push(`${signed(entry.integrated)} LUFS`);
  if (typeof entry.truePeak === 'number') parts.push(`${signed(entry.truePeak)} dBTP`);
  parts.push(clock(entry.time));
  return parts.join(' · ');
}
