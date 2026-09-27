import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

// GitHub Pages serves the site from /tingly-box/; relative asset URLs keep the
// build portable (custom domain, local preview) without hard-coding that base.
export default defineConfig({
  base: './',
  resolve: {
    alias: {
      // Reuse the app's own IM / editor icons instead of copying them.
      '@app-assets': fileURLToPath(new URL('../frontend/src/assets', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['..'] },
  },
});
