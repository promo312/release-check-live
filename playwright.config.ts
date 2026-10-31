import { defineConfig } from '@playwright/test';
const port = Number(process.env.E2E_PORT || 5183);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1, timeout: 140000,
  use: {
    baseURL, viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1,
    launchOptions: { executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] },
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
  },
  webServer: { command: 'npm start', url: `${baseURL}/api/health`, env: { PORT: String(port), MODE: 'demo' }, reuseExistingServer: false, timeout: 30000 },
});
