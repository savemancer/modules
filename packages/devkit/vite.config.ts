import { defineConfig } from 'vite';

export default defineConfig({
  // Временные иконки и лого лежат в /brand — отдаём их как статику
  publicDir: '../../brand',
  server: { fs: { allow: ['../..'] } },
  worker: { format: 'es' },
});
