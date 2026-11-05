import { defineConfig } from 'vite';

// Relative base so the build works on GitHub Pages project sites (/basketsmash/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
  },
});
