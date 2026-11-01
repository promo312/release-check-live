import { expect, test, type WebSocketRoute } from '@playwright/test';
import { ReleaseSession } from '../../server/session';
import { goodFrame } from '../helpers';

test('overlay load, reload and reconnect synchronize an open vote before showing a final verdict', async ({ page }) => {
  let clock = Date.now();
  const session = new ReleaseSession(() => clock, 'twitch');
  session.setAudio(true, 'Reference.wav', { kind: 'file', preset: 'original', paused: false, muted: false });
  session.meters(goodFrame({ measurementId: session.state.runId }));
  session.command('producer', 'producer', '!check');
  clock += 30000;
  session.meters(goodFrame({ measurementId: session.state.runId })); session.tick();
  session.command('listener', 'listener', '!ready');
  clock += 3000;
  const end = session.state.voteEndsAt!;
  let requests = 0;
  const sockets: WebSocketRoute[] = [];
  const snapshot = () => JSON.stringify({ type: 'state', now: clock, state: {
    ...session.state,
    // A leftover verdict must never override the authoritative open phase.
    verdict: session.state.phase === 'voting' ? 'Too few votes' : session.state.verdict,
  } });
  await page.routeWebSocket('**/ws?role=overlay', socket => {
    sockets.push(socket);
    socket.onMessage(raw => {
      if (JSON.parse(raw.toString()).type === 'get-state') { requests++; socket.send(snapshot()); }
    });
    socket.send(JSON.stringify({ type: 'role', controller: false }));
  });

  await page.goto('/overlay');
  await expect.poll(() => requests).toBe(1);
  await expect(page.locator('#ov-detail')).toHaveText('Chat is voting · 17s · Original');
  await expect(page.locator('#ov-ready')).toHaveText('1');
  await expect(page.locator('#ov-notyet')).toHaveText('0');
  await expect(page.locator('#ov-vote-count')).toHaveText('1 vote');
  await expect(page.getByText('Too few votes', { exact: false })).toHaveCount(0);

  clock += 3000;
  session.command('another listener', 'another', '!notyet');
  await page.reload();
  await expect.poll(() => requests).toBe(2);
  await expect(page.locator('#ov-detail')).toHaveText('Chat is voting · 14s · Original');
  await expect(page.locator('#ov-ready')).toHaveText('1');
  await expect(page.locator('#ov-notyet')).toHaveText('1');
  await expect(page.locator('#ov-vote-count')).toHaveText('2 votes');

  clock += 2000;
  await sockets.at(-1)!.close({ code: 1012, reason: 'Reconnect test' });
  await expect(page.locator('#ov-label')).toHaveText('Connection lost');
  await expect.poll(() => requests, { timeout: 7000 }).toBe(3);
  await expect(page.locator('#ov-detail')).toHaveText('Chat is voting · 12s · Original');
  await expect(page.locator('#ov-vote-count')).toHaveText('2 votes');
  await expect(page.locator('#ov-vote-bar')).toHaveAttribute('style', 'width: 50%;');
  expect(session.state.voteEndsAt).toBe(end);
  expect(session.state.phase).toBe('voting');

  clock = end + 1; session.tick();
  sockets.at(-1)!.send(snapshot());
  await expect(page.locator('#ov-detail')).toHaveText('Too few votes · Original');
  await expect(page.locator('#ov-vote-count')).toHaveText('2 votes');
});
