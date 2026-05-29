declare module "@halo/telemetry-discovery-js" {
  export interface TelemetryDiscoveryConfig {
    appName: string;
    endpoint: string;
    token: string;
    queueMaxEvents?: number;
    batchSize?: number;
    flushIntervalMs?: number;
    requestTimeoutMs?: number;
    maxConcurrentFlushes?: number;
    maxPayloadBytes?: number;
    sampleSuccessRate?: number;
    runtimeMetricsIntervalMs?: number;
  }

  export interface ExpressTelemetryOptions {
    includeBodies?: boolean;
    maxBodyBytes?: number;
  }

  export interface TelemetryDiscoveryInstance {
    track: (rawPayload: Record<string, unknown>) => boolean;
    createExpressMiddleware: (options?: ExpressTelemetryOptions) => (req: unknown, res: unknown, next: () => void) => void;
    flush: () => Promise<void>;
    shutdown: () => Promise<void>;
    getStats: () => Record<string, number>;
  }

  export function initTelemetryDiscovery(config: TelemetryDiscoveryConfig): TelemetryDiscoveryInstance;
}
