import { defineConfig, devices } from '@playwright/test';

// Базовый порт статического сервера. В тестах /api/* перехватывается page.route().
const PORT = 8788;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  timeout: 30_000,

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
    video: 'off'
  },

  projects: [
    {
      name: 'chromium',
      use: devices['Desktop Chrome']
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] }
    }
  ],

  // Статический сервер для html/css/js. /api/* перехватывается тестами.
  // python3 есть на всех runner'ах GitHub Actions и на Windows из Microsoft Store.
  webServer: {
    command: `python -m http.server ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
    stdout: 'pipe',
    stderr: 'pipe'
  }
});
