import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['process'],
      globals: { process: true, global: true },
    }),
    react(),
    tailwindcss(),
  ],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
      // pdfjs-dist (react-pdf) references `process` in the browser bundle
      process: path.resolve(__dirname, 'node_modules/process/browser.js'),
    },
  },
  optimizeDeps: {
    include: ['pdfjs-dist', 'react-pdf', 'process/browser'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/test-fixtures': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
