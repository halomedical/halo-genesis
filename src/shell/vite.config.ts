import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const haloComponentsRoot = path.resolve(
  __dirname,
  process.env.HALO_COMPONENTS_PATH || '../../../halo-components'
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react'),
      'halo-components/admin-agent-panel': path.resolve(
        haloComponentsRoot,
        'agents/admin-agent/client/components/AdminAgentPanel.tsx'
      ),
      'halo-components/admin-agent-onboarding': path.resolve(
        haloComponentsRoot,
        'agents/admin-agent/client/components/AdminAgentOnboarding.tsx'
      ),
      'halo-components/header-consultation-recorder': path.resolve(
        haloComponentsRoot,
        'agents/scribe-agent/client/features/scribe/HeaderConsultationRecorder.tsx'
      ),
      'halo-components/billing-page': path.resolve(
        haloComponentsRoot,
        'agents/billing-agent/client/BillingPage.tsx'
      ),
    },
  },
  server: {
    port: 5173,
    fs: {
      // Allow imports from sibling workspace repo (halo-components)
      allow: [path.resolve(__dirname, '../../..')],
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
