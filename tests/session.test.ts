import { beforeEach, describe, expect, it } from 'vitest';
import { ReleaseSession, validMeter } from '../server/session';
import type { MeterFrame } from '../src/core/types';
import { goodFrame } from './helpers';

describe('check and voting lifecycle', () => {
  let clock: number, session: ReleaseSession;
  beforeEach(() => {
    clock = 1000; session = new ReleaseSession(() => clock, 'twitch');
    session.setAudio(true, 'Test input'); session.meters(goodFrame({ measurementId: session.state.runId }));
  });
  const finishCheck = () => {
    for (let i = 1; i <= 30; i++) {
      clock += 1000;
      session.meters(goodFrame({ measurementId: session.state.runId, seconds: i })); session.tick();
    }
  };
  it('measures a fresh 30-second window, opens voting, accepts vote changes and finalizes', () => {
    expect(session.command('alice', 'a', '!check')).toBeNull();
    session.meters(goodFrame({ measurementId: 'old', integrated: -5 }));
    expect(session.state.meters!.integrated).toBe(-14);
    expect(session.command('alice', 'a', '!ready')).toContain('Voting opens');
    finishCheck(); expect(session.state.phase).toBe('voting'); expect(session.state.result!.score).toBe(100);
    session.command('alice', 'a', '!ready'); session.command('alice', 'a', '!ready');
    expect(session.state.votes.ready).toBe(1);
    session.command('alice', 'a', '!notyet'); session.command('bob', 'b', '!ready');
    expect(session.state.votes).toEqual({ ready: 1, notyet: 1 });
    session.command('dana', 'd', '!ready'); session.command('eli', 'e', '!notyet');
    clock += 20000; session.tick(); expect(session.state.verdict).toBe('Chat result: tied');
    expect(session.command('chris', 'c', '!ready')).toContain('Voting opens');
    session.command('alice', 'a', '!fix'); expect(session.state.fixVisible).toBe(true);
    expect(session.state.history[0].verdict).toBe('Chat result: tied');
  });
  it('does not overlap checks or reset an active round via a reward', () => {
    session.command('alice', 'a', '!check');
    const run = session.state.runId;
    expect(session.reward('bob')).toContain('in progress'); expect(session.state.runId).toBe(run);
  });
  it('cancels on a lost input and never scores stale audio', () => {
    session.command('alice', 'a', '!check'); clock += 3000; session.tick();
    expect(session.state.phase).toBe('idle'); expect(session.state.result).toBeNull(); expect(session.state.audioActive).toBe(false);
  });
  it('reports no verdict when nobody votes', () => {
    session.reward('alice'); finishCheck(); clock += 20000; session.tick();
    expect(session.state.verdict).toBe('Too few votes');
    expect(session.state.chat.at(-1)!.text).toBe('Chat result: too few votes (0 votes). 0 ready · 0 not yet.');
  });
  it('needs three votes for a chat result and always reports the count', () => {
    session.command('alice', 'a', '!check'); finishCheck();
    session.command('bob', 'b', '!notyet'); clock += 20000; session.tick();
    expect(session.state.verdict).toBe('Too few votes'); expect(session.state.history[0].verdict).toBe('Too few votes');
    expect(session.state.chat.at(-1)!.text).toBe('Chat result: too few votes (1 vote). 0 ready · 1 not yet.');
  });
  it('records source, integrated loudness and true peak on each history entry', () => {
    session.command('alice', 'a', '!check'); finishCheck();
    expect(session.state.history[0]).toMatchObject({ source: 'Test input', integrated: -14, truePeak: -2 });
    session.reset(); session.setAudio(true, 'USB interface', { kind: 'input', preset: 'original', paused: false, muted: true });
    session.meters(goodFrame({ measurementId: session.state.runId }));
    session.command('alice', 'a', '!check'); finishCheck();
    expect(session.state.history[0].source).toBe('Live input');
  });
  it('accepts frames from older clients without a balance reading and skips the balance check', () => {
    const legacy = (overrides: Partial<MeterFrame>) => { const { balance: _, ...frame } = goodFrame(overrides); return frame as MeterFrame; };
    expect(validMeter(legacy({}))).toBe(true);
    session.meters(legacy({ measurementId: session.state.runId }));
    session.command('alice', 'a', '!check');
    for (let i = 1; i <= 30; i++) {
      clock += 1000;
      session.meters(legacy({ measurementId: session.state.runId, seconds: i })); session.tick();
    }
    expect(session.state.phase).toBe('voting');
    expect(session.state.result!.score).toBe(100);
    expect(session.state.result!.findings.map(f => f.id)).not.toContain('balance');
  });
  it('scores a sustained L/R gap collected from frames during the check', () => {
    session.command('alice', 'a', '!check');
    for (let i = 1; i <= 30; i++) {
      clock += 1000;
      session.meters(goodFrame({ measurementId: session.state.runId, seconds: i, balance: i >= 10 && i < 16 ? -5 : 0 })); session.tick();
    }
    expect(session.state.result!.topIssue).toBe('Stereo balance off: left/right differ by 5.0 dB');
    expect(session.state.result!.score).toBe(83);
  });
  it('separates simulated votes from Twitch mode and resets the round without losing history', () => {
    session.command('alice', 'a', '!check'); finishCheck(); clock += 5000; session.tick();
    expect(session.state.votes.ready).toBe(0);
    session.reset(); expect(session.state.phase).toBe('idle'); expect(session.state.result).toBeNull(); expect(session.state.history).toHaveLength(1);
  });
  it('resets a result when the preset changes, closes the old vote and rejects previous readings', () => {
    session.command('alice', 'a', '!check'); finishCheck();
    const oldRun = session.state.runId;
    session.setAudio(true, 'Test input', { kind: 'file', preset: 'hot', paused: false, muted: false });
    expect(session.state.phase).toBe('idle'); expect(session.state.result).toBeNull();
    expect(session.state.history[0].verdict).toBe('Audio changed before voting ended');
    session.meters(goodFrame({ measurementId: oldRun })); expect(session.state.meters).toBeNull();
    expect(session.command('alice', 'a', '!check')).toContain('Start the audio');
  });
  it('keeps a muted check running, but cancels a paused check without unloading the track', () => {
    session.command('alice', 'a', '!check'); const run = session.state.runId;
    session.setAudio(true, 'Test input', { ...session.state.audioDetails, muted: true });
    expect(session.state.phase).toBe('checking'); expect(session.state.runId).toBe(run);
    session.setAudio(false, 'Test input', { ...session.state.audioDetails, paused: true });
    expect(session.state.phase).toBe('idle'); expect(session.state.audioSource).toBe('Test input');
    expect(session.state.audioDetails.paused).toBe(true); expect(session.state.meters).toBeNull();
  });
});

it('rejects malformed and nonfinite meter frames before accepting WebSocket data', () => {
  expect(validMeter(goodFrame())).toBe(true);
  expect(validMeter(goodFrame({ integrated: NaN }))).toBe(false);
  expect(validMeter(goodFrame({ bands: [Infinity] }))).toBe(false);
  expect(validMeter(goodFrame({ clipRatio: -1 }))).toBe(false);
  expect(validMeter(goodFrame({ balance: null }))).toBe(true);
  expect(validMeter(goodFrame({ balance: Infinity }))).toBe(false);
  expect(validMeter({ type: 'meters' })).toBe(false);
  expect(validMeter(null)).toBe(false);
});
