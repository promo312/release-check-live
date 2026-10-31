import { randomUUID } from 'node:crypto';
import { scoreCheck } from '../src/core/scoring';
import { COMMANDS, type Command, type MeterFrame, type SessionState } from '../src/core/types';

export function validMeter(value: unknown): value is MeterFrame {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  const finite = (v: unknown, low: number, high: number) => typeof v === 'number' && Number.isFinite(v) && v >= low && v <= high;
  if (typeof m.measurementId !== 'string' || m.measurementId.length > 100) return false;
  if (!finite(m.seconds, 0, 1e7) || !finite(m.sampleRate, 8000, 192000)) return false;
  for (const key of ['shortTerm', 'momentary', 'integrated', 'truePeak', 'peakHold', 'rms', 'left', 'right']) {
    if (m[key] !== null && !finite(m[key], -300, 100)) return false;
  }
  if (m.correlation !== null && !finite(m.correlation, -1, 1)) return false;
  if (!finite(m.width, 0, 101) || !finite(m.crest, 0, 200) || !finite(m.bassRatio, 0, 1)) return false;
  if (!finite(m.clipRatio, 0, 1)) return false;
  return Array.isArray(m.bands) && m.bands.length <= 64 && m.bands.every(v => finite(v, 0, 1));
}

export class ReleaseSession {
  readonly state: SessionState;
  private sequence = 0;
  private voters = new Map<string, 'ready' | 'notyet'>();
  private lastMeterAt = 0;
  private demoVoteIndex = 0;
  private demoVoteAt = 0;
  private readonly demoVoters = ['kickpilot', 'sinewave', 'melo_d', 'subculture', 'luna.wav', 'tapehead', 'lowendleo', 'echoes'];

  constructor(private now = () => Date.now(), mode: 'demo' | 'twitch' = 'demo', private checkMs = 30000, private voteMs = 20000) {
    this.state = {
      mode, twitchStatus: mode === 'demo' ? 'demo' : 'connecting',
      twitchDetail: mode === 'demo' ? 'Local demo · no Twitch connection' : 'Connecting to Twitch',
      audioActive: false, audioSource: 'No audio selected', meters: null,
      audioDetails: { kind: 'demo', preset: 'original', paused: false, muted: true },
      phase: 'idle', runId: 'monitor', checkEndsAt: null, voteEndsAt: null, result: null,
      votes: { ready: 0, notyet: 0 }, verdict: null, fixVisible: false, chat: [], history: [],
    };
    this.log('Release Check', mode === 'demo' ? 'Demo room ready. Start the audio, then send !check. Audience messages and votes are simulated.' : 'Choose an audio input to begin.', 'system');
  }

  log(name: string, text: string, kind: 'system' | 'chat' | 'reward' = 'system') {
    this.state.chat.push({ id: ++this.sequence, name: name.slice(0, 40), text: text.slice(0, 350), kind, time: this.now() });
    this.state.chat = this.state.chat.slice(-60);
  }

  setAudio(active: boolean, source: string, details = this.state.audioDetails) {
    const changed = source !== this.state.audioSource || details.kind !== this.state.audioDetails.kind || details.preset !== this.state.audioDetails.preset;
    const transportChanged = active !== this.state.audioActive || details.paused !== this.state.audioDetails.paused;
    if (changed) {
      if (this.state.phase === 'voting' && this.state.history[0]) {
        this.state.history[0].verdict = 'Audio changed before voting ended';
        this.log('Release Check', 'Audio changed; the previous vote is closed. Run a fresh check for this version.');
      }
      this.clearRound();
    } else if (transportChanged && this.state.phase === 'checking') this.cancel('Playback paused. Start a fresh check with a continuous 30-second section.');
    this.state.audioActive = active;
    this.state.audioSource = source.slice(0, 100) || 'No audio selected';
    this.state.audioDetails = { ...details };
    if (changed || transportChanged) this.state.meters = null;
    this.lastMeterAt = this.now();
  }

  meters(frame: MeterFrame) {
    if (!this.state.audioActive) return;
    // Discard queued frames from before the worklet's reset.
    if (frame.measurementId !== this.state.runId) return;
    this.state.meters = frame;
    this.lastMeterAt = this.now();
  }

  command(name: string, userId: string, command: string, log = true): string | null {
    const normalized = command.trim().toLowerCase();
    if (!COMMANDS.includes(normalized as Command)) return null;
    if (log) this.log(name, normalized, 'chat');
    if (normalized === '!check') return this.startCheck(name);
    if (normalized === '!fix') {
      if (!this.state.result) return 'Run a check first to get a measured suggestion.';
      this.state.fixVisible = true;
      this.log('Release Check', this.state.result.fix);
      return null;
    }
    if (this.state.phase !== 'voting' || this.now() >= (this.state.voteEndsAt ?? 0)) return 'Voting opens after the 30-second check.';
    const vote = normalized === '!ready' ? 'ready' : 'notyet';
    this.voters.set(userId, vote);
    this.state.votes = {
      ready: [...this.voters.values()].filter(v => v === 'ready').length,
      notyet: [...this.voters.values()].filter(v => v === 'notyet').length,
    };
    return null;
  }

  reward(name: string) {
    this.log(name, 'Requested a release check', 'reward');
    const error = this.startCheck(name);
    if (error) this.log('Release Check', error);
    return error;
  }

  private startCheck(name: string): string | null {
    if (this.state.phase === 'checking' || this.state.phase === 'voting') return 'A check is in progress. Let this round finish.';
    if (!this.state.audioActive || !this.state.meters || this.state.meters.integrated === null || this.now() - this.lastMeterAt > 1500) return 'Start the audio and let the meters settle before checking.';
    this.state.phase = 'checking'; this.state.runId = randomUUID();
    this.state.checkEndsAt = this.now() + this.checkMs;
    this.state.voteEndsAt = null; this.state.result = null; this.state.fixVisible = false;
    this.state.verdict = null; this.state.votes = { ready: 0, notyet: 0 }; this.voters.clear();
    this.log('Release Check', `${name} started a 30-second release check. Keep the track playing.`);
    return null;
  }

  private clearRound() {
    this.state.phase = 'idle'; this.state.runId = randomUUID();
    this.state.result = null; this.state.checkEndsAt = null; this.state.voteEndsAt = null;
    this.state.votes = { ready: 0, notyet: 0 }; this.voters.clear();
    this.state.verdict = null; this.state.fixVisible = false;
    this.state.meters = null;
  }

  reset() {
    this.clearRound();
    this.log('Release Check', 'New round. Meters reset; previous checks stay in the session history.');
  }

  private cancel(reason: string) {
    this.state.phase = 'idle'; this.state.checkEndsAt = null;
    this.state.runId = randomUUID(); this.log('Release Check', reason);
  }

  tick() {
    if (this.state.audioActive && this.now() - this.lastMeterAt > 2500) {
      // A capture interruption cancels an unfinished check, but the last
      // measured result and its audience vote still belong to this source.
      this.setAudio(false, this.state.audioSource, { ...this.state.audioDetails, paused: true });
      this.log('Release Check', 'Audio stopped arriving. Choose a source and start again.');
    }
    if (this.state.phase === 'checking' && this.now() >= this.state.checkEndsAt!) {
      const frame = this.state.meters;
      const result = frame?.measurementId === this.state.runId ? scoreCheck(frame, this.now(), this.state.audioDetails.preset) : null;
      if (!result) { this.cancel('Not enough audible material for a score. Play a continuous 30-second section and try again.'); return; }
      this.state.result = result; this.state.phase = 'voting';
      this.state.checkEndsAt = null; this.state.voteEndsAt = this.now() + this.voteMs;
      this.demoVoteIndex = 0; this.demoVoteAt = this.now() + 1200;
      this.log('Release Check', `${result.score}/100 · ${result.topIssue}. Vote !ready or !notyet. You have 20 seconds.`);
      this.state.history.unshift({ score: result.score, topIssue: result.topIssue, time: result.checkedAt, verdict: null });
      this.state.history = this.state.history.slice(0, 12);
    }
    if (this.state.phase === 'voting') {
      if (this.state.mode === 'demo' && this.now() >= this.demoVoteAt && this.demoVoteIndex < this.demoVoters.length && this.now() < this.state.voteEndsAt!) {
        const i = this.demoVoteIndex++;
        const ready = this.state.result!.score >= 80 ? i !== 3 : i % 3 === 0;
        this.command(this.demoVoters[i], `demo:${i}`, ready ? '!ready' : '!notyet');
        this.demoVoteAt = this.now() + 1500;
      }
      if (this.now() >= this.state.voteEndsAt!) {
        const { ready, notyet } = this.state.votes;
        this.state.verdict = ready + notyet === 0 ? 'Chat result: no votes' : ready === notyet ? 'Chat result: tied' : ready > notyet ? 'Chat result: ready' : 'Chat result: not yet';
        this.state.phase = 'complete'; this.state.voteEndsAt = null;
        this.state.history[0].verdict = this.state.verdict;
        this.log('Release Check', `${this.state.verdict}. ${ready} ready · ${notyet} not yet.`);
      }
    }
  }
}
