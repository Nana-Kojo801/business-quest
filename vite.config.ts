import { defineConfig } from 'vite';

// Relative base so the build works at any hosting sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
