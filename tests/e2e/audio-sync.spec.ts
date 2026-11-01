import { expect, test } from '@playwright/test';

test('a playing control room republishes audio and fresh analysis after reconnect so the overlay can score it', async ({ page, context }) => {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    Object.assign(window, { controlSockets: sockets });
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        if (String(url).includes('/ws?role=controller')) sockets.push(this);
      }
    };
  });
  const overlay = await context.newPage();
  await overlay.goto('/overlay');
  await page.goto('/');
  await expect(page.locator('#owner-notice')).toBeHidden();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(overlay.locator('#ov-integrated')).not.toHaveText('—', { timeout: 12000 });
  await expect(overlay.locator('#overlay-status')).toHaveText('Analyzing demo audio');

  // The local source keeps playing while its server connection is replaced.
  await page.evaluate(() => (window as unknown as { controlSockets: WebSocket[] }).controlSockets[0].close(4000, 'Connection interrupted'));
  await expect.poll(() => page.evaluate(() => (window as unknown as { controlSockets: WebSocket[] }).controlSockets.length)).toBe(2);
  await expect(page.locator('#owner-notice')).toBeHidden();
  await expect(overlay.locator('#overlay-status')).toHaveText('Analyzing demo audio', { timeout: 12000 });
  await expect(overlay.locator('#ov-integrated')).not.toHaveText('—');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeEnabled();

  await page.locator('#chat-input').fill('!check');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(overlay.locator('#ov-label')).toHaveText('30-second release check');
  await expect(page.locator('#vote-ready')).toBeEnabled({ timeout: 40000 });
  const score = await page.locator('#score-number').innerText();
  expect(Number(score)).toBeGreaterThanOrEqual(85);
  await expect(overlay.locator('#ov-score')).toHaveText(score);
  await expect(overlay.locator('#ov-title')).toHaveText(await page.locator('#check-description').innerText());
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
});
