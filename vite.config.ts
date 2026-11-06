import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so Capacitor's WebView can load assets offline from the APK.
  base: './',
  build: {
    // three.js alone is ~600 kB minified; the game ships as a single chunk on purpose.
    chunkSizeWarningLimit: 900,
  },
});
