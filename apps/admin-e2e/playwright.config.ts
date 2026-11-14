import { defineConfig, devices } from '@playwright/test'

import { env } from './src/env'

// One browser, one worker: each role test signs in once and walks every route
// in a single page, so the session's refresh cookie is never presented by two
// tabs at once (a rotated cookie presented twice ends the session as reuse).
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.e2e.ts',
  outputDir: '../../test-output/admin-e2e/results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A role walks ~40 routes; each may wait up to env.stuckMs for loaders.
  timeout: 15 * 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: '../../test-output/admin-e2e/report', open: 'never' }],
  ],
  use: {
    baseURL: env.baseUrl,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    locale: 'ru-RU',
    timezoneId: 'Asia/Tomsk',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
