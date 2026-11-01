import './style.css';
import { AudioEngine } from './audio/engine';
import { COMMANDS, type AudioSourceKind, type ClientMessage, type DemoProfile, type MasterPreset, type ServerMessage, type SessionState } from './core/types';
import { historyLabel } from './core/history';
import { voteCount } from './core/votes';
import { icon } from './ui/icons';
import { audioStatus, chatStatus } from './ui/status';
import { controlRoom, overlay } from './ui/template';

const isOverlay = location.pathname === '/overlay';
document.body.classList.toggle('overlay-page', isOverlay);
document.documentElement.classList.toggle('overlay-document', isOverlay);
document.querySelector<HTMLDivElement>('#app')!.innerHTML = isOverlay ? overlay() : controlRoom();
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const put = (id: string, value: string) => { const node = el(id); if (node && node.textContent !== value) node.textContent = value; };
const hide = (id: string, value: boolean) => { const node = el(id); if (node) node.hidden = value; };
const disabled = (id: string, value: boolean) => { const node = el<HTMLButtonElement>(id); if (node) node.disabled = value; };
const db = (value: number | null | undefined, digits = 1) => value === null || value === undefined ? '—' : value.toFixed(digits).replace('-', '−');
let state: SessionState | null = null;
let ws: WebSocket;
let connected = false;
let controller = false;
let busy = false;
let serverOffset = 0;
let lastRunId = '';
let lastChatId = -1;
let historyKey = '';
let retryTimer: ReturnType<typeof setTimeout>;
let toastTimer: ReturnType<typeof setTimeout>;
let sourceType: AudioSourceKind = 'demo';
let sourceName = '';

const send = (message: ClientMessage) => { if (ws?.readyState === WebSocket.OPEN && (controller || message.type === 'take-control')) ws.send(JSON.stringify(message)); };
const toast = (message: string) => {
  if (isOverlay) return;
  put('toast', message); hide('toast', false); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide('toast', true), 6500);
};
const engine = isOverlay ? null : new AudioEngine(frame => send({ type: 'meters', meters: frame }), () => {
  syncAudio(); render(); toast('Playback paused. Press Play to continue.');
});

function syncAudio() {
  if (!engine) return;
  send({ type: 'audio', active: engine.playing, source: engine.loaded ? sourceName : '', details: {
    kind: sourceType, preset: engine.preset, paused: engine.loaded && !engine.playing, muted: engine.muted,
  } });
}

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=${isOverlay ? 'overlay' : 'controller'}`);
  ws.onopen = () => {
    // An overlay must synchronize before displaying any cached round verdict.
    connected = !isOverlay;
    if (isOverlay) { render(); ws.send(JSON.stringify({ type: 'get-state' } satisfies ClientMessage)); }
  };
  ws.onmessage = event => {
    let message: ServerMessage;
    try { message = JSON.parse(event.data) as ServerMessage; } catch { return; }
    if (message.type === 'role') {
      if (controller && !message.controller) void engine?.stop();
      controller = message.controller;
      if (!isOverlay) {
        hide('owner-notice', controller);
      }
    }
    if (message.type === 'error') toast(message.message);
    if (message.type === 'state') {
      connected = true;
      state = message.state; serverOffset = message.now - Date.now();
      if (state.runId !== lastRunId) { lastRunId = state.runId; engine?.reset(state.runId); }
      render();
    }
  };
  ws.onclose = () => {
    connected = false; controller = false;
    if (!isOverlay) void engine?.stop();
    render(); clearTimeout(retryTimer); retryTimer = setTimeout(connect, 1600);
  };
  ws.onerror = () => ws.close();
}
function remaining(end: number | null): number { return end ? Math.max(0, Math.ceil((end - Date.now() - serverOffset) / 1000)) : 0; }

function render() {
  if (!state) return;
  if (isOverlay) { renderOverlay(); return; }
  const can = connected && controller && !busy;
  const active = state.audioActive && connected;
  const details = state.audioDetails;
  disabled('take-control', !connected || busy || state.audioActive || details.paused);
  const playing = controller ? engine!.playing : active;
  const loaded = controller ? engine!.loaded : active || details.paused;
  const muted = controller ? engine!.muted : details.muted;
  const m = active ? state.meters : null;
  const checking = state.phase === 'checking', voting = state.phase === 'voting';
  const inRound = checking || voting;
  const connection = el('connection');
  connection.replaceChildren(Object.assign(document.createElement('span'), { className: 'dot' }), document.createTextNode(connected ? 'Local connection' : 'Reconnecting…'));
  connection.style.color = connected ? '' : '#e6a274';
  put('channel-status', chatStatus(state, connected));
  put('source-kind', { demo: 'DEMO AUDIO', file: 'LOCAL TRACK', input: 'AUDIO INPUT' }[details.kind]);
  put('source-tag', details.preset === 'hot' ? 'Hot master · +6 dB / hard clip' : 'Original');
  put('source-name', loaded ? state.audioSource : 'Choose a track or play the demo');
  put('source-description', details.paused ? 'Paused · position retained' : details.kind === 'file' ? 'Local playback · loop enabled' : details.kind === 'input' ? 'Local capture · input monitoring muted' : 'Original synthesis · 112 BPM · stereo');
  const audioButton = el<HTMLButtonElement>('audio-toggle');
  audioButton.innerHTML = busy ? 'Opening audio…' : `${icon(playing ? 'pause' : 'play')} ${playing ? 'Pause' : 'Play'}`;
  audioButton.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  audioButton.disabled = !can;
  disabled('open-audio-file', !can || checking);
  disabled('profile', !can || checking || details.kind !== 'demo');
  disabled('monitor', !can || !loaded || details.kind === 'input');
  el('monitor').innerHTML = icon(muted ? 'mute' : 'volume');
  el('monitor').setAttribute('aria-pressed', String(muted));
  el('monitor').setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
  el('monitor').title = details.kind === 'input' ? 'Input monitoring muted' : muted ? 'Sound muted' : 'Sound on';
  for (const preset of ['original', 'hot'] as const) {
    disabled(`preset-${preset}`, !can || !loaded || checking || details.kind === 'input');
    el(`preset-${preset}`).setAttribute('aria-pressed', String(details.preset === preset));
  }
  document.querySelectorAll<HTMLButtonElement>('[data-open="audio"]').forEach(b => b.disabled = !can || checking);
  put('short-term', db(m?.shortTerm)); put('integrated', db(m?.integrated)); put('true-peak', db(m?.peakHold));
  put('width', m && m.integrated !== null ? db(m.width, 0) : '—');
  put('peak-caption', m && m.clipRatio > 0 ? `${(100 * m.clipRatio).toFixed(2)}% at full scale` : 'Hold since reset · 4×');
  put('correlation-caption', `Correlation ${db(m?.correlation, 2)}`);
  el('true-peak').classList.toggle('warn', m?.peakHold !== null && m?.peakHold !== undefined && m.peakHold > -1);
  put('sample-rate', `${m ? Math.round(m.sampleRate / 1000) : 48} kHz / STEREO`);
  el('signal-status').replaceChildren(Object.assign(document.createElement('span'), { className: 'dot' }), document.createTextNode(audioStatus(state, connected)));
  el('signal-status').classList.toggle('active', active);
  hide('spectrum-idle', active);
  for (const [side, value] of [['left', m?.left], ['right', m?.right]] as const) {
    el(`level-${side}`).style.width = `${value === null || value === undefined ? 0 : Math.max(0, Math.min(100, (value + 60) / 60 * 100))}%`;
    put(`${side}-db`, value === null || value === undefined ? '−∞' : db(value));
  }
  disabled('meter-reset', !can || inRound);
  const seconds = remaining(state.checkEndsAt);
  put('score-number', checking ? String(seconds) : state.result ? String(state.result.score) : '—');
  put('score-unit', checking ? 'SEC LEFT' : '/ 100');
  const progress = checking ? (30 - seconds) / 30 : state.result ? state.result.score / 100 : 0;
  el('score-progress').style.strokeDashoffset = String(301.6 * (1 - progress));
  put('check-title', checking ? 'Listening a little closer.' : state.result?.label ?? 'Ready for a closer listen?');
  put('check-description', checking ? 'Keep the track playing. Chat votes next.' : state.result?.topIssue ?? 'Run a 30-second check to see your score and the next useful fix.');
  const runButton = el<HTMLButtonElement>('run-check');
  runButton.innerHTML = checking ? `${icon('wave')} Check in progress <kbd>${seconds}s</kbd>` : voting ? `${icon('chat')} Chat is voting <kbd>${remaining(state.voteEndsAt)}s</kbd>` : `${icon('bolt')} ${state.result ? 'Run another check' : 'Run release check'} <kbd>!check</kbd>`;
  runButton.disabled = !can || !active || !m || m.integrated === null || inRound;
  hide('check-progress', !checking);
  el('check-progress').firstElementChild!.setAttribute('style', `width:${(30 - seconds) / 30 * 100}%`);
  hide('show-fix', !state.result); disabled('show-fix', !can);
  hide('fix-panel', !state.result || !state.fixVisible); put('fix-panel', state.result?.fix ?? '');
  put('vote-timer', voting ? `${remaining(state.voteEndsAt)} SEC LEFT` : state.phase === 'complete' ? 'VOTE CLOSED' : 'OPENS AFTER CHECK');
  put('vote-title', voting ? 'Chat result: voting' : state.phase === 'complete' ? state.verdict ?? 'Chat result: waiting' : 'Chat result: waiting');
  put('vote-description', voting ? 'Send !ready or !notyet in chat.' : state.phase === 'complete' ? 'Your ears make the final call.' : 'Voting opens after the check.');
  put('ready-count', String(state.votes.ready)); put('notyet-count', String(state.votes.notyet));
  const total = state.votes.ready + state.votes.notyet;
  put('vote-count', voteCount(total));
  el('ready-bar').style.width = `${total ? state.votes.ready / total * 100 : 0}%`;
  el('notyet-bar').style.width = `${total ? state.votes.notyet / total * 100 : 0}%`;
  disabled('vote-ready', !can || !voting); disabled('vote-notyet', !can || !voting);
  el('chat-mode').innerHTML = `<span class="dot"></span>${chatStatus(state, connected)}<span>${state.mode === 'demo' ? 'Simulated audience' : state.twitchStatus === 'connected' && connected ? 'Connected' : 'Not connected'}</span>`;
  el<HTMLFormElement>('chat-form').hidden = state.mode !== 'demo';
  hide('demo-reward', state.mode !== 'demo'); disabled('demo-reward', !can || inRound);
  disabled('chat-input', !can);
  document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(b => b.disabled = !can);
  put('twitch-detail', state.twitchDetail);
  renderChat(); renderHistory();
}

function renderChat() {
  if (!state || state.chat.at(-1)?.id === lastChatId) return;
  lastChatId = state.chat.at(-1)?.id ?? 0;
  const container = el('chat-messages');
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  const fragment = document.createDocumentFragment();
  for (const entry of state.chat) {
    const node = document.createElement('div'); node.className = `chat-entry ${entry.kind}`;
    const name = document.createElement('div'); name.className = 'chat-name';
    const label = document.createElement('span'); label.textContent = entry.name; name.append(label);
    const time = document.createElement('time'); time.textContent = new Date(entry.time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false }); name.append(time);
    const text = document.createElement('p');
    if (COMMANDS.includes(entry.text as typeof COMMANDS[number])) {
      const code = document.createElement('code'); code.textContent = entry.text; text.append(code);
    } else text.textContent = entry.text;
    node.append(name, text); fragment.append(node);
  }
  container.replaceChildren(fragment);
  if (atBottom) container.scrollTop = container.scrollHeight;
}

function renderHistory() {
  if (!state) return;
  const key = JSON.stringify(state.history);
  if (key === historyKey) return;
  historyKey = key;
  put('history-count', `${state.history.length} CHECK${state.history.length === 1 ? '' : 'S'}`);
  if (!state.history.length) return;
  const fragment = document.createDocumentFragment();
  for (const entry of state.history) {
    const row = document.createElement('div'); row.className = 'history-row';
    const score = document.createElement('strong'); score.textContent = String(entry.score);
    const title = document.createElement('span'); title.textContent = entry.topIssue;
    const verdict = document.createElement('small'); verdict.textContent = entry.verdict ?? 'Vote in progress';
    const label = document.createElement('time'); label.dateTime = new Date(entry.time).toISOString(); label.textContent = historyLabel(entry);
    row.append(score, title, verdict, label); fragment.append(row);
  }
  el('history-list').replaceChildren(fragment);
}

function renderOverlay() {
  if (!state) return;
  const m = connected && state.audioActive ? state.meters : null;
  put('ov-short', db(m?.shortTerm)); put('ov-integrated', db(m?.integrated)); put('ov-peak', db(m?.peakHold));
  put('ov-width', m?.integrated !== null && m ? db(m.width, 0) : '—');
  el('overlay-status').replaceChildren(Object.assign(document.createElement('span'), { className: 'dot' }), document.createTextNode(audioStatus(state, connected)));
  put('ov-mode', `${chatStatus(state, connected)}${state.mode === 'demo' ? ' · Simulated votes' : ''}`);
  let progress = 0;
  put('ov-score-unit', state.phase === 'checking' ? 'SEC LEFT' : '/ 100');
  if (!connected) {
    const syncing = ws?.readyState === WebSocket.OPEN;
    put('ov-score', '—'); put('ov-label', syncing ? 'Syncing session' : 'Connection lost'); put('ov-title', syncing ? 'Syncing with the control room' : 'Reconnecting to the control room'); put('ov-detail', 'Keep the local server and control room open.');
  } else if (state.phase === 'checking') {
    const left = remaining(state.checkEndsAt); progress = (30 - left) / 30;
    put('ov-score', String(left)); put('ov-label', '30-second release check'); put('ov-title', 'Listening…'); put('ov-detail', 'Loudness · Headroom · Stereo balance');
  } else if (state.result) {
    put('ov-score', String(state.result.score)); put('ov-label', state.result.label);
    put('ov-title', state.result.topIssue);
    const voteStatus = state.phase === 'voting' ? `Chat is voting · ${remaining(state.voteEndsAt)}s` : state.phase === 'complete' ? state.verdict ?? 'Vote closed' : 'Chat vote pending';
    put('ov-detail', `${voteStatus} · ${state.audioDetails.preset === 'hot' ? 'Hot master +6 dB' : 'Original'}`);
    progress = state.result.score / 100;
  } else {
    put('ov-score', '—'); put('ov-label', 'Release check'); put('ov-title', 'Chat: !check'); put('ov-detail', state.audioActive ? 'A 30-second check. Then chat votes.' : 'Press Play in the control room.');
  }
  el('ov-progress').style.width = `${progress * 100}%`;
  put('ov-ready', String(state.votes.ready)); put('ov-notyet', String(state.votes.notyet));
  put('ov-vote-count', voteCount(state.votes.ready + state.votes.notyet));
  const total = state.votes.ready + state.votes.notyet;
  el('ov-vote-bar').style.width = `${total ? state.votes.ready / total * 100 : 50}%`;
  hide('ov-fix', !connected || !state.fixVisible); put('ov-fix', state.result?.fix ?? '');
}

async function startAudio(kind: AudioSourceKind, file?: File) {
  if (!controller || busy || !engine || state?.phase === 'checking') return;
  busy = true; render();
  send({ type: 'audio', active: false, source: '' });
  try {
    if (kind === 'demo') {
      const profile = el<HTMLSelectElement>('profile').value as DemoProfile;
      await engine.demo(profile);
      sourceName = { balanced: 'After hours / Balanced mix', hot: 'After hours / Too loud', phase: 'After hours / Phase issue' }[profile];
    } else if (kind === 'file' && file) { await engine.file(file); sourceName = file.name; }
    else {
      const select = el<HTMLSelectElement>('input-device');
      await engine.input(select.value || undefined);
      sourceName = select.selectedOptions[0]?.textContent ?? 'Audio input';
    }
    sourceType = kind; syncAudio();
  } catch (error) {
    toast(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Audio input permission was declined. Choose the demo or a local track, or allow microphone access in your browser.' : 'Could not open this audio source. Try another file or select an available input.');
    syncAudio();
  } finally { busy = false; render(); }
}

async function togglePlayback() {
  if (!engine || busy || !controller) return;
  if (!engine.loaded) { await startAudio('demo'); return; }
  busy = true;
  try {
    if (engine.playing) await engine.pause(); else await engine.play();
    syncAudio();
  } catch { toast('Playback could not continue. Choose the audio source again.'); }
  finally { busy = false; render(); }
}

function changePreset(preset: MasterPreset) {
  if (!engine || !controller || busy || !engine.loaded || state?.phase === 'checking' || sourceType === 'input') return;
  if (engine.preset === preset) return;
  engine.setPreset(preset); syncAudio();
}

if (!isOverlay) {
  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach(button => button.addEventListener('click', () => openDialog(button.dataset.open!)));
  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog')!.close()));
  document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } }));
  el('audio-toggle').addEventListener('click', () => { void togglePlayback(); });
  el('take-control').addEventListener('click', () => send({ type: 'take-control' }));
  el('profile').addEventListener('change', () => { if (engine?.loaded) void startAudio('demo'); });
  el('monitor').addEventListener('click', () => { engine?.toggleMonitor(); syncAudio(); render(); });
  el('preset-original').addEventListener('click', () => changePreset('original'));
  el('preset-hot').addEventListener('click', () => changePreset('hot'));
  el('run-check').addEventListener('click', () => send({ type: 'command', command: '!check' }));
  el('vote-ready').addEventListener('click', () => send({ type: 'command', command: '!ready' }));
  el('vote-notyet').addEventListener('click', () => send({ type: 'command', command: '!notyet' }));
  el('show-fix').addEventListener('click', () => send({ type: 'command', command: '!fix' }));
  el('meter-reset').addEventListener('click', () => send({ type: 'reset' }));
  el('demo-reward').addEventListener('click', () => send({ type: 'demo-reward' }));
  el('chat-form').addEventListener('submit', event => {
    event.preventDefault(); const input = el<HTMLInputElement>('chat-input');
    if (input.value.trim()) send({ type: 'demo-chat', name: 'you', text: input.value.trim() });
    input.value = '';
  });
  document.querySelectorAll<HTMLButtonElement>('[data-command]').forEach(button => button.addEventListener('click', () => send({ type: 'command', command: button.dataset.command as typeof COMMANDS[number] })));
  el('setup-audio').addEventListener('click', () => { el<HTMLDialogElement>('setup-dialog').close(); openDialog('audio'); });
  const overlayUrl = `${location.origin}/overlay`; put('overlay-url', overlayUrl);
  el('copy-overlay').addEventListener('click', () => { void navigator.clipboard.writeText(overlayUrl).then(() => toast('OBS overlay URL copied.')).catch(() => toast(`OBS overlay: ${overlayUrl}`)); });
  el('choose-demo').addEventListener('click', () => { el<HTMLDialogElement>('audio-dialog').close(); void startAudio('demo'); });
  const chooseFile = () => { el<HTMLDialogElement>('audio-dialog').close(); el<HTMLInputElement>('audio-file').click(); };
  el('choose-file').addEventListener('click', chooseFile);
  el('open-audio-file').addEventListener('click', chooseFile);
  el('audio-file').addEventListener('change', () => {
    const input = el<HTMLInputElement>('audio-file'), file = input.files?.[0];
    if (file) void startAudio('file', file);
    input.value = '';
  });
  el('choose-input').addEventListener('click', () => { el<HTMLDialogElement>('audio-dialog').close(); void startAudio('input'); });
  window.addEventListener('beforeunload', () => { ws?.close(); });
  drawSpectrum();
}

function openDialog(name: string) {
  el<HTMLDialogElement>(`${name}-dialog`).showModal();
  if (name === 'audio') void navigator.mediaDevices?.enumerateDevices().then(devices => {
    const select = el<HTMLSelectElement>('input-device'); select.replaceChildren(new Option('Default audio input', ''));
    devices.filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default').forEach((d, i) => select.add(new Option(d.label || `Audio input ${i + 1}`, d.deviceId)));
  }).catch(() => { /* Default capture remains available when enumeration is refused. */ });
}

function drawSpectrum() {
  const canvas = el<HTMLCanvasElement>('spectrum');
  const ctx = canvas.getContext('2d')!;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let values = Array(56).fill(0) as number[];
  let previous = 0;
  const draw = (time: number) => {
    requestAnimationFrame(draw);
    if (document.hidden || time - previous < (reduced ? 250 : 32)) return;
    previous = time;
    const w = canvas.clientWidth, h = canvas.clientHeight, dpr = Math.min(devicePixelRatio, 2);
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#34402b'; ctx.lineWidth = 0.5;
    for (let i = 0; i <= 3; i++) { const y = h - 2 - i * (h - 6) / 3; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.strokeStyle = '#2b3525';
    for (let i = 0; i <= 5; i++) { ctx.beginPath(); ctx.moveTo(i * w / 5, 0); ctx.lineTo(i * w / 5, h); ctx.stroke(); }
    const bands = state?.audioActive && connected ? state.meters?.bands ?? [] : [];
    values = values.map((v, i) => reduced ? bands[i] ?? 0 : v + ((bands[i] ?? 0) - v) * 0.22);
    const bw = w / 56;
    for (let i = 0; i < 56; i++) {
      const height = Math.max(1, values[i] * (h - 8));
      const gradient = ctx.createLinearGradient(0, h - height, 0, h);
      gradient.addColorStop(0, '#c5ea88'); gradient.addColorStop(0.5, '#83a858'); gradient.addColorStop(1, '#3f582c');
      ctx.fillStyle = gradient;
      ctx.fillRect(i * bw + 1, h - height, Math.max(1, bw - 3), height);
      ctx.fillStyle = '#d5f4a3'; ctx.fillRect(i * bw + 1, h - height, Math.max(1, bw - 3), 1);
    }
  };
  requestAnimationFrame(draw);
}
connect();
