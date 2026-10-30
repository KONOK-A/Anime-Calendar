import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  build: { outDir: 'dist/client' },
  server: { proxy: { '/api': 'http://127.0.0.1:4317', '/media': 'http://127.0.0.1:4317' } },
});
