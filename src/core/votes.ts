export const MIN_VOTES = 3;

export const voteCount = (total: number) => `${total} vote${total === 1 ? '' : 's'}`;

export interface ChatVerdict { total: number; count: string; tooFew: boolean; verdict: string; message: string }

/** Under three votes there is no chat result, only the count. */
export function chatVerdict(votes: { ready: number; notyet: number }): ChatVerdict {
  const { ready, notyet } = votes;
  const total = ready + notyet;
  const count = voteCount(total);
  const tooFew = total < MIN_VOTES;
  const outcome = tooFew ? 'too few votes' : ready === notyet ? 'tied' : ready > notyet ? 'ready' : 'not yet';
  return {
    total, count, tooFew,
    verdict: tooFew ? 'Too few votes' : `Chat result: ${outcome}`,
    message: `Chat result: ${outcome} (${count}). ${ready} ready · ${notyet} not yet.`,
  };
}
