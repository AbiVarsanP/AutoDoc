import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
   build: {
    outDir: 'dist',
    sourcemap: true
  },
  server: {
    proxy: {
      // Proxy Hugging Face inference requests during development to avoid CORS
      '/api/hf': {
        target: 'https://api-inference.huggingface.co',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/hf/, '')
      }
    }
  }
});