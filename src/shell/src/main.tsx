import './index.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initTelemetryDiscoveryWeb } from '@halo/telemetry-discovery-web';

const telemetryUrl = import.meta.env.VITE_HALO_TELEMETRY_URL;
const telemetryToken = import.meta.env.VITE_HALO_TELEMETRY_TOKEN;

if (telemetryUrl && telemetryToken) {
  initTelemetryDiscoveryWeb({
    appName: 'halo-genesis-frontend',
    endpoint: telemetryUrl,
    token: telemetryToken,
    batchSize: 100,
    flushIntervalMs: 750,
    requestTimeoutMs: 500
  });
}

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
