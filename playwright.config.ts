import { defineConfig } from '@playwright/test';

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
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 720 },
    channel: process.env.CI ? undefined : 'chrome',
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webgl2', use: { baseURL: 'http://localhost:4173/' } },
    { name: 'canvas2d', use: { baseURL: 'http://localhost:4173/?renderer=canvas2d' } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
