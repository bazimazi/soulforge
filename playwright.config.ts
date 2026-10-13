import { defineConfig } from '@playwright/test';

const port = Number(process.env.SF_E2E_PORT || 4173);
const origin = `http://localhost:${port}`;

/**
 * End-to-end smoke tests against the production build (`vite preview`).
 * Locally they drive the installed Chrome; on CI, Playwright's bundled Chromium (SwiftShader WebGL).
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: origin,
    viewport: { width: 1280, height: 720 },
    channel: process.env.CI ? undefined : 'chrome',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webgl2', use: { baseURL: origin + '/' } },
    { name: 'canvas2d', use: { baseURL: origin + '/?renderer=canvas2d' } },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
