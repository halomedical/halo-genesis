declare module '@halo/telemetry-discovery-web' {
  export interface TelemetryDiscoveryWebConfig {
    appName: string;
    endpoint: string;
    token: string;
    batchSize?: number;
    flushIntervalMs?: number;
    requestTimeoutMs?: number;
    queueMaxEvents?: number;
    maxPayloadBytes?: number;
    sampleSuccessRate?: number;
  }

  export function initTelemetryDiscoveryWeb(
    config: TelemetryDiscoveryWebConfig
  ): {
    track: (rawPayload: Record<string, unknown>, options?: { forceKeep?: boolean }) => boolean;
    flush: () => Promise<void>;
    shutdown: () => Promise<void>;
    getStats: () => Record<string, number>;
  };
}
