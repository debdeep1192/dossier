import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Precaches the app's own production build output (JS/CSS/WASM/data,
    // fonts, icons) so that after the first successful load, Dossier boots
    // from the service-worker cache instead of the network — required for
    // reliable offline launch and fast reopen/refresh. Deliberately scoped
    // to globPatterns matching only what actually ships in dist/, so
    // nothing beyond the app's real production assets is cached.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null, // registered manually in main.jsx
      manifest: false, // public/manifest.json is already hand-authored and linked
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,data,svg,png,woff2}'],
        // The PGlite data file exceeds Workbox's default 2MB precache
        // limit; raise it to fit the actual (known, fixed) asset sizes
        // rather than silently dropping large files from the cache.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
      },
    }),
  ],
})
