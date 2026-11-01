import { describe, expect, it } from 'vitest';
import { chatVerdict, voteCount } from '../src/core/votes';

describe('vote count and verdict', () => {
  it('always shows the count with correct plurals', () => {
    expect([0, 1, 5].map(voteCount)).toEqual(['0 votes', '1 vote', '5 votes']);
  });
  it('reports too few votes under three', () => {
    expect(chatVerdict({ ready: 0, notyet: 0 })).toEqual({ total: 0, count: '0 votes', tooFew: true, verdict: 'Too few votes', message: 'Chat result: too few votes (0 votes). 0 ready · 0 not yet.' });
    expect(chatVerdict({ ready: 0, notyet: 1 }).message).toBe('Chat result: too few votes (1 vote). 0 ready · 1 not yet.');
    expect(chatVerdict({ ready: 2, notyet: 0 })).toMatchObject({ verdict: 'Too few votes', count: '2 votes' });
  });
  it('gives a result from three votes', () => {
    expect(chatVerdict({ ready: 2, notyet: 1 })).toMatchObject({ tooFew: false, verdict: 'Chat result: ready', message: 'Chat result: ready (3 votes). 2 ready · 1 not yet.' });
    expect(chatVerdict({ ready: 0, notyet: 3 }).verdict).toBe('Chat result: not yet');
  });
  it('handles ties below and above the minimum', () => {
    expect(chatVerdict({ ready: 1, notyet: 1 }).verdict).toBe('Too few votes');
    expect(chatVerdict({ ready: 2, notyet: 2 })).toMatchObject({ verdict: 'Chat result: tied', message: 'Chat result: tied (4 votes). 2 ready · 2 not yet.' });
  });
});
