import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'http://localhost:3000',
        ws: true
      },
      '/api': {
        target: 'http://localhost:3000'
      },
      '/auth': {
        target: 'http://localhost:3000'
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
