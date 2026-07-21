import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Vite config for the renderer process (React UI).
// Main/preload processes are compiled separately by tsc (see tsconfig.node.json).
//
// Two HTML entries:
//   - src/renderer/index.html    (main app window)
//   - src/renderer/stats.html    (statistics window)
// The stats window's React source lives under src/renderer-stats/
// and is imported relatively from stats.html.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist-renderer'),
    emptyOutDir: true,
    target: 'chrome120', // Modern Chromium target
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/renderer/index.html'),
        stats: resolve(__dirname, 'src/renderer/stats.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  clearScreen: false,
});