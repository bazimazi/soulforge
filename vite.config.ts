/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages, itch.io, file hosts).
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // Content (characters, weapons) is large but loads once; keep a single game chunk + vendor-free bundle.
    chunkSizeWarningLimit: 900,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'SOULFORGE: Endless Night',
        short_name: 'Soulforge',
        description: 'A survivors-like with deep meta progression. Survive the endless night.',
        theme_color: '#0b0910',
        background_color: '#0b0910',
        display: 'fullscreen',
        orientation: 'landscape',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: { include: ['src/core/**', 'src/game/**', 'src/meta/**'] },
  },
});
