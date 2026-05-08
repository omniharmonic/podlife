import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@pod-life/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'icons/icon-192.png',
        'icons/icon-512.png',
        'icons/icon-maskable-512.png',
        'icons/apple-touch-icon.png',
        'icons/apple-touch-icon-180.png',
        'icons/apple-touch-icon-167.png',
        'icons/apple-touch-icon-152.png',
        'icons/apple-touch-icon-120.png',
        'icons/apple-touch-icon-precomposed.png',
      ],
      manifest: {
        name: 'Pod Life',
        short_name: 'Pod Life',
        description: 'Care infrastructure for people who love more than one person.',
        // Brand parchment for the splash + status bar surround.
        theme_color: '#FAF6EF',
        background_color: '#FAF7F2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          // Maskable variant has parchment baked in + a 72% safe zone so
          // platforms that mask to circles/squircles don't clip the wordmark.
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Without this denylist, the SW happily catches navigations to
        // /auth/calendar/google (or any API-routed path) and serves the SPA
        // shell, which then redirects through React Router to /home —
        // breaking the OAuth flow. Keep this list aligned with the rewrites
        // in vercel.json that route to /api/index.
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/auth\//,
          /^\/internal\//,
          /^\/telegram\//,
          /^\/health$/,
        ],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
