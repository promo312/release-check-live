import { expect, test } from '@playwright/test';
import { createDemoBuffer } from '../../src/audio/demo';

test('real demo audio → 30-second score → chat voting → fix → OBS overlay', async ({ page, context, baseURL }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  context.on('request', request => { if (!request.url().startsWith(baseURL!) && !request.url().startsWith('data:')) external.push(request.url()); });
  await page.goto('/');
  await expect(page.getByText('Local connection', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Release Check Live.' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset meters' }).click();
  await expect(page.getByRole('button', { name: 'Run release check' })).toBeDisabled();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#short-term')).not.toHaveText('—', { timeout: 12000 });
  const loudness = Number((await page.locator('#integrated').innerText()).replace('−', '-'));
  expect(loudness).toBeGreaterThan(-20); expect(loudness).toBeLessThan(-10);
  await page.screenshot({ path: 'test-results/demo-listening.png', fullPage: true });
  const obs = await context.newPage(); await obs.goto('/overlay');
  await expect(obs.locator('#ov-short')).not.toHaveText('—');
  await expect(obs.locator('#ov-mode')).toContainText('Simulated votes');
  expect(await obs.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  await page.locator('#chat-input').fill('!check'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('#check-title')).toHaveText('Listening a little closer.');
  await expect(obs.locator('#ov-label')).toHaveText('30-second release check');
  await expect(page.locator('#vote-ready')).toBeEnabled({ timeout: 40000 });
  const score = Number(await page.locator('#score-number').innerText()); expect(score).toBeGreaterThanOrEqual(85);
  await page.locator('#vote-ready').click(); await page.locator('#vote-ready').click();
  await expect(page.locator('#chat-messages')).toContainText('!ready');
  // Joining an in-progress vote must retain the server's open window and counts.
  await obs.reload();
  await expect(obs.locator('#ov-detail')).toHaveText(/^Chat is voting · [1-9]\d?s · Original$/);
  await expect.poll(async () => {
    const [control, overlay] = await Promise.all([page.locator('#ready-count').innerText(), obs.locator('#ov-ready').innerText()]);
    return control === overlay && Number(overlay) >= 1;
  }).toBe(true);
  await expect(obs.getByText('Too few votes', { exact: false })).toHaveCount(0);
  await page.locator('#show-fix').click();
  await expect(page.locator('#fix-panel')).toBeVisible(); await expect(obs.locator('#ov-fix')).toBeVisible();
  await expect(page.locator('#vote-timer')).toHaveText('VOTE CLOSED', { timeout: 26000 });
  await expect(page.locator('#vote-title')).toHaveText('Chat result: ready');
  await expect(page.locator('#ready-count')).toHaveText('8'); // 7 scripted viewers + one local person
  await expect(page.locator('#notyet-count')).toHaveText('1');
  await expect(page.locator('.history-row').first()).toContainText(String(score));
  await expect(obs.locator('#ov-detail')).toContainText('Chat result: ready');
  await page.screenshot({ path: 'test-results/demo-verdict.png', fullPage: true });
  await obs.screenshot({ path: 'test-results/obs-overlay.png', omitBackground: true });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#short-term')).toHaveText('—');
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('responsive control room, loud example, and channel-points simulation', async ({ page, context, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByText('Local connection', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset meters' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#profile').selectOption('hot'); await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#short-term')).not.toHaveText('—', { timeout: 10000 });
  expect(Number((await page.locator('#true-peak').innerText()).replace('−', '-'))).toBeGreaterThan(-1);
  await page.locator('#demo-reward').click(); await expect(page.locator('#check-title')).toHaveText('Listening a little closer.');
  await expect(page.locator('#chat-messages')).toContainText('Requested a release check');
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  const observer = await context.newPage(); await observer.goto('/');
  await expect(observer.locator('#owner-notice')).toBeVisible(); await expect(observer.locator('#audio-toggle')).toBeDisabled();
  await observer.close();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#check-title')).toHaveText('Ready for a closer listen?');
  await page.getByRole('button', { name: 'Change audio source' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close audio sources' }).click();
  await page.getByRole('button', { name: 'Setup', exact: true }).click();
  await expect(page.locator('#overlay-url')).toHaveText(`${baseURL}/overlay`);
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('a local stereo file decodes without upload, and the phase example exposes cancellation', async ({ page }) => {
  await page.goto('/'); await expect(page.getByText('Local connection', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset meters' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#short-term')).not.toHaveText('—', { timeout: 10000 });
  const rate = 48000, frames = rate * 4, data = Buffer.alloc(44 + frames * 4);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i++) { const v = Math.round(0.1 * 32767 * Math.sin(2 * Math.PI * 1000 * i / rate)); data.writeInt16LE(v, 44 + i * 4); data.writeInt16LE(v, 46 + i * 4); }
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Open audio file', exact: true }).click(),
  ]);
  await fileChooser.setFiles({ name: 'local-reference.wav', mimeType: 'audio/wav', buffer: data });
  await expect(page.locator('#source-name')).toHaveText('local-reference.wav', { timeout: 20000 });
  await expect(page.locator('#source-kind')).toHaveText('LOCAL TRACK');
  await expect(page.locator('#short-term')).not.toHaveText('—', { timeout: 10000 });
  await expect(page.locator('#integrated')).toHaveText('−20.0');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open audio file', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/local-file-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({ path: 'test-results/local-file-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Change audio source' }).click();
  await page.locator('#choose-demo').click();
  await page.locator('#profile').selectOption('phase');
  await expect(page.locator('#correlation-caption')).toHaveText('Correlation −1.00', { timeout: 10000 });
  await expect(page.locator('#width')).toHaveText('100');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
});

function referenceTrack() {
  const channels: Float32Array[] = [];
  const context = { sampleRate: 48000, createBuffer: (_: number, length: number, sampleRate: number) => {
    channels.push(new Float32Array(length), new Float32Array(length));
    return { length, sampleRate, getChannelData: (i: number) => channels[i] };
  } } as unknown as BaseAudioContext;
  const buffer = createDemoBuffer(context, 'balanced');
  const data = Buffer.alloc(44 + buffer.length * 4);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(48000, 24); data.writeUInt32LE(192000, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(buffer.length * 4, 40);
  for (let i = 0; i < buffer.length; i++) for (let channel = 0; channel < 2; channel++) data.writeInt16LE(Math.round(channels[channel][i] * 32767), 44 + i * 4 + channel * 2);
  return { name: 'my-reference-track.wav', mimeType: 'audio/wav', buffer: data };
}

// This observes the actual 30-second windows and 20-second vote, without accelerated clocks.
test('1920×1080 video flow: own track, honest playback, Original score, Hot master, fix, votes and transparent OBS', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.locator('#owner-notice')).toBeHidden();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Open audio file', exact: true }).click()]);
  await chooser.setFiles(referenceTrack());
  await expect(page.locator('#source-name')).toHaveText('my-reference-track.wav');
  await expect(page.locator('#signal-status')).toHaveText('Analyzing local track');
  await expect(page.locator('#chat-mode')).toContainText('Demo chat');
  await expect(page.getByText('Live on Twitch', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Signal', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Chat', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(1);
  await expect(page.locator('#monitor')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Mute audio', exact: true }).click();
  await expect(page.locator('#monitor')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#short-term')).not.toHaveText('—', { timeout: 10000 });
  await page.getByRole('button', { name: 'Unmute audio', exact: true }).click();
  await expect(page.locator('#monitor')).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toHaveCount(1);
  await expect(page.locator('#signal-status')).toHaveText('Local track paused');
  await expect(page.locator('#source-name')).toHaveText('my-reference-track.wav');
  await expect(page.locator('#monitor')).toHaveAttribute('aria-pressed', 'false'); // Pausing is not muting.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.locator('#signal-status')).toHaveText('Analyzing local track');
  const composition = await page.evaluate(() => {
    const score = document.querySelector('.check-card')!.getBoundingClientRect();
    const issue = document.querySelector('#check-description')!.getBoundingClientRect();
    const signal = document.querySelector('.meters-card')!.getBoundingClientRect();
    const font = (selector: string) => parseFloat(getComputedStyle(document.querySelector(selector)!).fontSize);
    return { scoreAboveSignal: score.top < signal.top, issueVisible: issue.bottom < innerHeight, scoreFont: font('#score-number'), otherFont: Math.max(...['#short-term', '#integrated', '#true-peak', '#width', '#ready-count'].map(font)), scale: visualViewport!.scale, pixelRatio: devicePixelRatio };
  });
  expect(composition.scoreAboveSignal).toBe(true); expect(composition.issueVisible).toBe(true);
  expect(composition.scoreFont).toBeGreaterThan(composition.otherFont);
  expect(composition.scale).toBe(1); expect(composition.pixelRatio).toBe(1);
  await expect(page.locator('#short-term')).not.toHaveText('—', { timeout: 10000 });
  await page.locator('#chat-input').fill('!check'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('#preset-hot')).toBeDisabled();
  await expect(page.locator('#vote-ready')).toBeEnabled({ timeout: 40000 });
  const original = Number(await page.locator('#score-number').innerText()); expect(original).toBeGreaterThanOrEqual(85);
  await page.screenshot({ path: 'test-results/video-original-1920.png' });
  const obs = await context.newPage(); await obs.goto('/overlay');
  await expect(obs.locator('#ov-score')).toHaveText(String(original));
  expect(await obs.evaluate(() => [document.body, document.documentElement].every(node => getComputedStyle(node).backgroundColor === 'rgba(0, 0, 0, 0)'))).toBe(true);
  await page.getByRole('button', { name: 'Hot master +6 dB', exact: true }).click();
  await expect(page.locator('#preset-hot')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#score-number')).toHaveText('—');
  await expect(page.locator('#source-name')).toHaveText('my-reference-track.wav');
  await expect(page.locator('#peak-caption')).toContainText('% at full scale', { timeout: 10000 });
  await expect(page.locator('#short-term')).not.toHaveText('—', { timeout: 10000 });
  await page.locator('#chat-input').fill('!check'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('#vote-notyet')).toBeEnabled({ timeout: 40000 });
  const hot = Number(await page.locator('#score-number').innerText());
  expect(hot).toBeLessThan(original); expect(hot).toBeLessThanOrEqual(65);
  await expect(page.locator('#check-description')).toContainText('Clipping');
  await page.locator('#chat-input').fill('!fix'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('#fix-panel')).toContainText('Switch back to Original');
  await expect(obs.locator('#ov-score')).toHaveText(String(hot));
  await expect(obs.locator('#ov-title')).toContainText('Clipping');
  await expect(obs.locator('#ov-fix')).toContainText('−1 dBTP');
  await page.locator('#chat-input').fill('!notyet'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('#vote-timer')).toHaveText('VOTE CLOSED', { timeout: 26000 });
  await expect(page.locator('#vote-title')).toHaveText('Chat result: not yet');
  await expect(obs.locator('#ov-detail')).toContainText('Chat result: not yet');
  const overlayBounds = await obs.locator('.obs-overlay').boundingBox();
  expect(overlayBounds!.x).toBeGreaterThanOrEqual(0); expect(overlayBounds!.y).toBeGreaterThanOrEqual(0);
  expect(overlayBounds!.x + overlayBounds!.width).toBeLessThan(1920); expect(overlayBounds!.y + overlayBounds!.height).toBeLessThan(1080);
  await page.screenshot({ path: 'test-results/video-hot-1920.png' });
  await obs.screenshot({ path: 'test-results/video-overlay-1920.png', omitBackground: true });
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.locator('#preset-original')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#peak-caption')).toHaveText('Hold since reset · 4×');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  expect(errors).toEqual([]);
  console.log(`Video reference: Original ${original}/100 → Hot master ${hot}/100`);
});
