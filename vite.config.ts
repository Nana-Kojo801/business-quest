import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Relative base so the build works at any hosting sub-path.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
    // The game, plus the character showcase page.
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), showcase: resolve(__dirname, 'showcase.html') } },
  },
});
