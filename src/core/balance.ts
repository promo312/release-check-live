/** Short-term left/right level gap, sampled through a check. Pure, so tests can use synthetic frames. */
export interface BalanceFrame { seconds: number; gap: number | null }
export interface BalanceVerdict { seconds: number; meanGap: number; deduction: number }

export const BALANCE = { maxGap: 3, maxSeconds: 3, base: 15, cap: 25 };
const round = (n: number) => Math.round(n * 10) / 10;

/** Finds the longest continuous stretch with |L−R| above 3 dB. A stretch ends at the
 * first frame back in range (or a frame with no reading); it fails if it lasts longer than 3 s.
 * The reported gap is the mean |L−R| over that stretch, rounded to 0.1 dB. */
export function checkBalance(frames: readonly BalanceFrame[]): BalanceVerdict | null {
  let worst: { seconds: number; gaps: number[] } | null = null;
  let start = -1;
  const close = (end: number, endSeconds: number) => {
    const seconds = endSeconds - frames[start].seconds;
    if (!worst || seconds > worst.seconds) worst = { seconds, gaps: frames.slice(start, end).map(f => Math.abs(f.gap!)) };
    start = -1;
  };
  frames.forEach((frame, i) => {
    const off = frame.gap !== null && Math.abs(frame.gap) > BALANCE.maxGap;
    if (off && start < 0) start = i;
    else if (!off && start >= 0) close(i, frame.seconds);
  });
  if (start >= 0) close(frames.length, frames[frames.length - 1].seconds);
  const found = worst as { seconds: number; gaps: number[] } | null;
  if (!found || found.seconds <= BALANCE.maxSeconds) return null;
  const meanGap = round(found.gaps.reduce((a, b) => a + b, 0) / found.gaps.length);
  return { seconds: round(found.seconds), meanGap, deduction: Math.min(BALANCE.cap, BALANCE.base + Math.max(0, meanGap - BALANCE.maxGap)) };
}
