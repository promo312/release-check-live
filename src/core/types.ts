export type Phase = 'idle' | 'checking' | 'voting' | 'complete';
export type Command = '!check' | '!ready' | '!notyet' | '!fix';
export type DemoProfile = 'balanced' | 'hot' | 'phase';
export type MasterPreset = 'original' | 'hot';
export type AudioSourceKind = 'demo' | 'file' | 'input';
export interface AudioDetails {
  kind: AudioSourceKind;
  preset: MasterPreset;
  paused: boolean;
  muted: boolean;
}

export interface MeterFrame {
  measurementId: string;
  seconds: number;
  shortTerm: number | null;
  momentary: number | null;
  integrated: number | null;
  truePeak: number | null;
  peakHold: number | null;
  correlation: number | null;
  width: number;
  crest: number;
  bassRatio: number;
  rms: number | null;
  left: number | null;
  right: number | null;
  /** Short-term (3 s) left minus right level, dB. */
  balance: number | null;
  bands: number[];
  sampleRate: number;
  clipRatio: number;
}

export interface Finding {
  id: string;
  title: string;
  detail: string;
  fix: string;
  deduction: number;
}

export interface CheckResult {
  score: number;
  label: string;
  findings: Finding[];
  topIssue: string;
  fix: string;
  meters: MeterFrame;
  checkedAt: number;
}

export interface HistoryEntry {
  score: number;
  topIssue: string;
  time: number;
  verdict: string | null;
  /** Added later; older entries may lack these. */
  source?: string;
  integrated?: number | null;
  truePeak?: number | null;
}

export interface ChatEntry {
  id: number;
  name: string;
  text: string;
  kind: 'system' | 'chat' | 'reward';
  time: number;
}

export interface SessionState {
  mode: 'demo' | 'twitch';
  twitchStatus: 'demo' | 'connecting' | 'connected' | 'error';
  twitchDetail: string;
  audioActive: boolean;
  audioSource: string;
  audioDetails: AudioDetails;
  meters: MeterFrame | null;
  phase: Phase;
  runId: string;
  checkEndsAt: number | null;
  voteEndsAt: number | null;
  result: CheckResult | null;
  votes: { ready: number; notyet: number };
  verdict: string | null;
  fixVisible: boolean;
  chat: ChatEntry[];
  history: HistoryEntry[];
}

export type ClientMessage =
  | { type: 'take-control' }
  | { type: 'meters'; meters: MeterFrame }
  | { type: 'audio'; active: boolean; source: string; details?: AudioDetails }
  | { type: 'command'; command: Command }
  | { type: 'demo-chat'; name: string; text: string }
  | { type: 'demo-reward' }
  | { type: 'reset' };

export type ServerMessage =
  | { type: 'state'; state: SessionState; now: number }
  | { type: 'role'; controller: boolean }
  | { type: 'error'; message: string };

export const COMMANDS: Command[] = ['!check', '!ready', '!notyet', '!fix'];
