import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: { alias: { '@shared': resolve(__dirname, '../../src/shared') } },
  server: { host: '127.0.0.1' },
  build: { outDir: '../../node_modules/.cache/rdc-agent/design-system', emptyOutDir: true },
});
