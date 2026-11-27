import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { deploymentRetryNavigation } from './src/utils/deploymentRecovery.js'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
  plugins: [
    {
      name: 'cloudflare-public-metadata',
      apply: 'build',
      transformIndexHtml(html) {
        if (process.env.VITE_REALTIME_TRANSPORT !== 'native') return html;
        const supplied = process.env.VITE_SITE_ORIGIN || loadEnv('production', process.cwd(), 'VITE_').VITE_SITE_ORIGIN || '';
        const origin = supplied ? new URL(supplied).origin : '';
        if (origin && !/^https?:\/\//.test(origin)) throw new Error('VITE_SITE_ORIGIN must be an HTTP(S) origin');
        return html.replaceAll('https://wchly.vercel.app', origin);
      },
    },
    react(),
    VitePWA({
      registerType: 'prompt',
      workbox: { skipWaiting: false, clientsClaim: false, globPatterns: ['**/*.{js,wasm,css,html,woff2}'], globIgnores: ['**/bg-video*.mp4', '**/bg-video*.webm'], navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/auth\/callback(?:\/|\?|$)/, deploymentRetryNavigation] },
      includeAssets: ['logo.png', 'logo-512.png', 'bg-video-poster.jpg', 'assets/sofa-couple-mobile.webp'],
      manifest: {
        name: 'Watchly',
        short_name: 'Watchly',
        description: 'Watch videos together in perfect sync.',
        theme_color: '#060612',
        background_color: '#060612',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/logo.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/logo-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ],
})
