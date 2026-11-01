import { icon } from './icons';

export const controlRoom = () => `
  <aside class="rail" aria-label="Navigation">
    <a href="/" class="brand-mark" aria-label="Release Check Live">${icon('wave')}</a>
    <nav><a href="#" class="rail-button selected" aria-label="Control room" title="Control room">${icon('grid')}</a><a href="#history" class="rail-button" aria-label="Session history" title="Session history">${icon('history')}</a><button class="rail-button" data-open="setup" aria-label="Setup" title="Setup">${icon('settings')}</button></nav>
    <div class="rail-bottom"><span class="rail-line"></span><span class="avatar" title="Ninja MDE">N<span class="avatar-dot"></span></span></div>
  </aside>
  <div class="workspace">
    <header class="topbar"><div class="breadcrumb"><span>NINJA MDE</span><span class="slash">/</span> RELEASE TOOLS</div><div class="topbar-right"><span class="connection" id="connection"><span class="dot"></span> Connecting</span><span class="channel-status" id="channel-status">Demo chat</span><button class="quiet" data-open="setup">Quick setup ${icon('external')}</button></div></header>
    <main>
      <section class="page-heading"><div><h1>Release Check <span>Live</span><span class="title-dot">.</span></h1><p>Measure. Fix. Release.</p></div><a href="/overlay" target="_blank" rel="noopener" class="button secondary" id="overlay-link">${icon('external')} Open OBS overlay</a></section>
      <div id="owner-notice" class="notice" hidden><span>Another control room owns the audio. Take control when it is idle, or close that tab and reload.</span><button class="button secondary small" id="take-control" disabled>Take control</button></div>
      <section class="source-bar" aria-label="Audio controls">
        <div class="source-art">${icon('wave')}</div>
        <div class="source-info"><div class="source-label"><span id="source-kind">DEMO AUDIO</span><span class="source-tag" id="source-tag">Original</span></div><strong id="source-name">A loop to get you started</strong><span id="source-description">Original synthesis · 112 BPM · stereo</span></div>
        <div class="source-actions">
          <button class="button secondary open-audio-file" id="open-audio-file" type="button" disabled>${icon('upload')} Open audio file</button>
          <label class="profile-control"><span class="sr-only">Demo profile</span><select id="profile"><option value="balanced">Balanced mix</option><option value="hot">Too loud (generated)</option><option value="phase">Phase issue</option></select>${icon('chevron')}</label>
          <div class="master-toggle" role="group" aria-label="Master preset"><button id="preset-original" aria-pressed="true" disabled>Original</button><button id="preset-hot" aria-pressed="false" title="Add +6 dB and hard clipping to playback. The file stays unchanged." disabled>Hot master <small>+6 dB</small></button></div>
          <button class="icon-button" id="monitor" aria-label="Audio muted" aria-pressed="true" disabled>${icon('mute')}</button>
          <button class="button primary" id="audio-toggle" aria-label="Play" disabled>${icon('play')} Play</button>
          <button class="icon-button source-settings" data-open="audio" aria-label="Change audio source" title="Change audio source">${icon('settings')}</button>
        </div>
      </section>
      <input type="file" id="audio-file" accept="audio/*,.wav,.mp3,.flac,.m4a,.ogg" hidden/>
      <div class="dashboard-grid">
        <div class="signal-column">
          <div class="results-grid">
            <section class="card check-card" aria-label="Release check">
              <div class="card-heading compact"><h2>Release check</h2><span class="small-tag">30 SEC</span></div>
              <div class="check-content">
                <div class="score-ring"><svg viewBox="0 0 112 112" aria-hidden="true"><circle class="ring-track" cx="56" cy="56" r="48"/><circle id="score-progress" cx="56" cy="56" r="48"/></svg><div><strong id="score-number">—</strong><span id="score-unit">/ 100</span></div></div>
                <div class="check-copy"><h3 id="check-title">Ready for a closer listen?</h3><span class="summary-label">TOP ISSUE</span><p id="check-description">Run a 30-second check to see your score and the next useful fix.</p></div>
              </div>
              <button class="button primary full" id="run-check">${icon('bolt')} Run release check <kbd>!check</kbd></button>
              <div id="check-progress" class="check-timeline" hidden><span></span></div>
              <button class="fix-button" id="show-fix" hidden>${icon('bolt')} Show the next useful fix <kbd>!fix</kbd>${icon('arrow')}</button>
              <div id="fix-panel" class="fix-panel" hidden></div><div class="check-footnote">A measured perspective. Your ears make the call.</div>
            </section>
            <section class="card vote-card" aria-label="Audience vote">
              <div class="card-heading compact"><span class="eyebrow muted">CHAT VOTE</span><span class="small-tag" id="vote-timer">OPENS AFTER CHECK</span></div>
              <div class="vote-title"><h2 id="vote-title">Chat result: waiting</h2><p id="vote-description">Voting opens after the check.</p></div>
              <div class="vote-totals"><div><span class="vote-label ready-label"><span class="dot"></span> Ready</span><strong id="ready-count">0</strong></div><span class="vote-versus">vs.</span><div><span class="vote-label notyet-label">Not yet <span class="dot"></span></span><strong id="notyet-count">0</strong></div></div>
              <div class="vote-bar" aria-label="Vote split"><div id="ready-bar"></div><div id="notyet-bar"></div></div>
              <div class="vote-actions"><button id="vote-ready" class="vote-button" disabled>${icon('check')} <span>Ready</span><kbd>!ready</kbd></button><button id="vote-notyet" class="vote-button" disabled>${icon('refresh')} <span>Not yet</span><kbd>!notyet</kbd></button></div>
              <div class="vote-footnote" id="vote-footnote"><strong id="vote-count">0 votes</strong> · One vote per person. You can change your vote. Three votes give a result.</div>
            </section>
          </div>
          <section class="card meters-card" aria-label="Audio meters">
            <div class="card-heading"><h2>Signal</h2><span class="live-label" id="signal-status"><span class="dot"></span> Choose audio</span></div>
            <div class="meter-values">
              <div class="meter-value main-meter"><div class="metric-label">SHORT-TERM LOUDNESS</div><div><strong id="short-term">—</strong><span class="unit">LUFS</span></div><span class="metric-caption">3-second window</span></div>
              <div class="meter-value"><div class="metric-label">INTEGRATED</div><div><strong id="integrated">—</strong><span class="unit">LUFS</span></div><span class="metric-caption">Gated · since reset</span></div>
              <div class="meter-value"><div class="metric-label">TRUE PEAK</div><div><strong id="true-peak">—</strong><span class="unit">dBTP</span></div><span class="metric-caption" id="peak-caption">4× oversampling</span></div>
              <div class="meter-value"><div class="metric-label">STEREO WIDTH</div><div><strong id="width">—</strong><span class="unit">%</span></div><span class="metric-caption" id="correlation-caption">Correlation —</span></div>
            </div>
            <div class="spectrum-wrap"><div class="spectrum-meta"><span>FREQUENCY SPECTRUM</span><span><i class="legend-dot"></i> L + R</span></div><canvas id="spectrum" aria-label="Live audio frequency spectrum"></canvas><div class="spectrum-idle" id="spectrum-idle"><span class="idle-symbol">${icon('wave')}</span><span>Press Play to analyze audio.</span></div><div class="frequency-labels"><span>40 Hz</span><span>100</span><span>250</span><span>1k</span><span>4k</span><span>16k</span></div></div>
            <div class="level-section"><div class="level-row"><span>L</span><div class="level-track"><div id="level-left"></div><i></i></div><span id="left-db">−∞</span></div><div class="level-row"><span>R</span><div class="level-track"><div id="level-right"></div><i></i></div><span id="right-db">−∞</span></div></div>
            <div class="meter-footer"><span id="sample-rate">48 kHz / STEREO</span><span>TARGET <b>−14 LUFS</b> <span class="footer-separator">/</span> CEILING <b>−1 dBTP</b></span><button class="text-button" id="meter-reset" aria-label="Reset meters">${icon('refresh')} Reset</button></div>
          </section>
        </div>
        <section class="card chat-card" aria-label="Chat activity">
          <div class="chat-heading"><h2>Chat</h2><span class="chat-icon">${icon('chat')}</span></div>
          <div class="chat-mode" id="chat-mode"><span class="dot"></span> Demo chat <span>Simulated audience</span></div>
          <div id="chat-messages" class="chat-messages" role="log" aria-live="polite" aria-label="Chat messages"></div>
          <div class="chat-bottom"><div class="command-chips"><button data-command="!check">!check</button><button data-command="!ready">!ready</button><button data-command="!notyet">!notyet</button><button data-command="!fix">!fix</button></div><form id="chat-form"><label class="sr-only" for="chat-input">Try a chat command</label><input id="chat-input" placeholder="Try a command…" maxlength="350" autocomplete="off"/><button aria-label="Send message" type="submit">${icon('arrow')}</button></form><button id="demo-reward" class="reward-button"><span class="reward-gem">◇</span> Try a channel-points request ${icon('arrow')}</button></div>
        </section>
      </div>
      <section id="history" class="history-section"><div class="history-heading"><h2>History</h2><span class="small-tag" id="history-count">0 CHECKS</span></div><div id="history-list" class="history-list"><div class="history-empty">${icon('history')}<span>Completed checks appear here.</span><span class="history-empty-detail">Local session · clears on restart</span></div></div></section>
      <footer class="page-footer"><span>RELEASE CHECK LIVE <span class="footer-separator">/</span> By Ninja MDE <span class="credit-name">(Vadim Timchenko)</span></span><span>Measure. Fix. Release. <i class="legend-dot"></i></span></footer>
    </main>
  </div>
  <dialog id="setup-dialog" class="dialog"><div class="dialog-heading"><div><span class="eyebrow muted">TAKE IT LIVE</span><h2>Your sound, on screen.</h2></div><button class="icon-button" data-close aria-label="Close setup">${icon('close')}</button></div><div class="setup-step"><span class="step-number">01</span><div><h3>Choose your audio</h3><p>Use the generated demo, open a local track, or capture a stereo loopback input. Audio stays on this computer.</p><button class="button secondary small" id="setup-audio">${icon('headphones')} Audio source</button></div></div><div class="setup-step"><span class="step-number">02</span><div><h3>Add the OBS overlay</h3><p>Add a Browser Source at 1920 × 1080. Keep this control room open; the overlay receives the same meters and votes.</p><div class="copy-field"><code id="overlay-url"></code><button id="copy-overlay" class="icon-button" aria-label="Copy OBS overlay URL">${icon('copy')}</button></div></div></div><div class="setup-step"><span class="step-number">03</span><div><h3>Bring Twitch into the room</h3><p>Set <code>MODE=twitch</code>, your client ID, and a broadcaster user access token in <code>.env</code>. Restart to connect chat and a custom channel-points reward. See the project README for the exact steps.</p><div class="setup-status" id="twitch-detail"></div></div></div><div class="dialog-note">The audio score follows documented house preferences. It does not measure taste, arrangement, or the full track’s readiness.</div></dialog>
  <dialog id="audio-dialog" class="dialog"><div class="dialog-heading"><div><span class="eyebrow muted">THE SOURCE</span><h2>What are we listening to?</h2></div><button class="icon-button" data-close aria-label="Close audio sources">${icon('close')}</button></div><button class="source-option" id="choose-demo"><span class="source-option-icon">${icon('wave')}</span><span><strong>Generated demo</strong><small>An original loop. No account or file needed.</small></span>${icon('arrow')}</button><button class="source-option" id="choose-file"><span class="source-option-icon">${icon('upload')}</span><span><strong>Open a local track</strong><small>WAV, MP3, FLAC, M4A, or OGG · loops locally</small></span>${icon('arrow')}</button><div class="input-option"><div class="source-option-icon">${icon('headphones')}</div><div><strong>Capture an audio input</strong><p>Select your interface or stereo loopback. Browser Sources do not automatically receive the OBS mixer.</p><label for="input-device" class="sr-only">Audio input device</label><select id="input-device"><option value="">Default audio input</option></select><button id="choose-input" class="button secondary small">Use this input ${icon('arrow')}</button></div></div><div class="dialog-note">Input capture asks for microphone permission. Use a stereo loopback device for desktop playback. Monitoring stays off for inputs to prevent feedback.</div></dialog>
  <div id="toast" class="toast" role="status" hidden></div>
`;

export const overlay = () => `
  <div class="obs-overlay">
    <header><div class="overlay-logo">${icon('wave')}</div><div><strong>RELEASE CHECK <span>LIVE</span></strong><small>Measure. Fix. Release.</small></div><span id="overlay-status"><span class="dot"></span> Connecting</span></header>
    <div class="overlay-round">
      <div class="overlay-score"><strong id="ov-score">—</strong><span id="ov-score-unit">/ 100</span><span id="ov-label">Release check</span></div>
      <strong id="ov-title">Chat: !check</strong><p id="ov-detail">Start audio in the control room.</p>
      <div class="overlay-progress"><i id="ov-progress"></i></div>
    </div>
    <div class="overlay-metrics"><div><span>SHORT-TERM</span><strong id="ov-short">—</strong><small>LUFS</small></div><div><span>INTEGRATED</span><strong id="ov-integrated">—</strong><small>LUFS</small></div><div><span>TRUE PEAK</span><strong id="ov-peak">—</strong><small>dBTP</small></div><div><span>WIDTH</span><strong id="ov-width">—</strong><small>%</small></div></div>
    <div class="overlay-votes"><span><b id="ov-ready">0</b> !ready</span><div aria-label="Chat vote bar"><i id="ov-vote-bar"></i></div><span><b id="ov-notyet">0</b> !notyet</span><small id="ov-vote-count">0 votes</small></div>
    <div id="ov-fix" hidden></div><footer><span id="ov-mode">Demo chat · Simulated votes</span><span>BY NINJA MDE</span></footer>
  </div>
`;
