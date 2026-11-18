import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Built into the Python package and served by `openleads ui` at /studio/.
export default defineConfig({
  base: '/studio/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@zory/core': fileURLToPath(new URL('./core/index.ts', import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL('../openleads/web/studio', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      // The editor, plus `auto.js`: Studio's engines for the app's Sites screen
      // (templates, the command validator, the renderer) with no editor attached.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        auto: fileURLToPath(new URL('./src/auto/index.ts', import.meta.url)),
      },
      preserveEntrySignatures: 'exports-only',
      output: {
        entryFileNames: (chunk) => (chunk.name === 'auto' ? 'auto.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
  server: {
    port: 5174,
    proxy: { '/api': 'http://127.0.0.1:8765', '/s/': 'http://127.0.0.1:8765' },
  },
});
