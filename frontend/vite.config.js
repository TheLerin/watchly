import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { deploymentRetryNavigation } from './src/utils/deploymentRecovery.js'
import { pageMetadataHtml, cleanOrigin } from './social-preview/siteMetadata.js'

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
        const values = { ...loadEnv('production', process.cwd(), 'VITE_'), ...process.env };
        const origin = cleanOrigin(values.VITE_SITE_ORIGIN);
        let result = pageMetadataHtml(html, '/', origin);
        for (const [key, name] of [['VITE_GOOGLE_SITE_VERIFICATION', 'google-site-verification'], ['VITE_BING_SITE_VERIFICATION', 'msvalidate.01']]) {
          if (values[key]) {
            if (!/^[A-Za-z0-9_-]{8,256}$/.test(values[key])) throw new Error(`Invalid ${key}`);
            result = result.replace(new RegExp(`<meta\\b[^>]*name="${name}"[^>]*>`, 'g'), '').replace('</head>', `<meta name="${name}" content="${values[key]}" />\n</head>`);
          }
        }
        return result;
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
