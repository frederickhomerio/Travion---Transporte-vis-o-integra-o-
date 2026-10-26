import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: o build funciona em qualquer hospedagem estática (rotas usam hash).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
