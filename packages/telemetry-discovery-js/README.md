# @halo/telemetry-discovery-js

Maximal discovery SDK for Node apps with performance-safe async batching.

## Install (from monorepo path)

Use a local path install in an app:

`npm install ../telemetry-endpoint/packages/telemetry-discovery-js`

## One-line startup

```js
import { initTelemetryDiscovery } from "@halo/telemetry-discovery-js";

const telemetry = initTelemetryDiscovery({
  appName: "genesis",
  endpoint: process.env.HALO_TELEMETRY_URL,
  token: process.env.HALO_TELEMETRY_TOKEN
});
```

## Express/Nest inbound auto-hook

For Express apps, or NestJS using the Express adapter:

```js
const telemetry = initTelemetryDiscovery({
  appName: "genesis",
  endpoint: process.env.HALO_TELEMETRY_URL,
  token: process.env.HALO_TELEMETRY_TOKEN
});

app.use(
  telemetry.createExpressMiddleware({
    includeBodies: true,
    maxBodyBytes: 256 * 1024
  })
);
```

## Additional maximal auto-hooks (Node)

Enabled by default after `initTelemetryDiscovery(...)`:

- `fs.promises` operations (`readFile`, `writeFile`, `appendFile`, `unlink`, `readdir`, `stat`, `rename`, `mkdir`, `rm`)
- `child_process` execution (`exec`, `execFile`, `spawn`, `fork`)
- periodic runtime metrics (CPU approximation, memory, uptime)
- Postgres query hooks for `pg.Client` and `pg.Pool`
- Queue hooks for `bull` and `bullmq` (enqueue, completed, failed)
- Provider hooks for `openai`, `@google/generative-ai`, and `twilio` common methods
- Additional provider hooks: `@deepgram/sdk`, `googleapis` (Drive/Calendar/Gmail/Sheets/OAuth via request layer), AWS SDK v3 middleware stack, `firebase-admin` (Firestore/RTDB/Storage surfaces), and `nodemailer`
- Auth and analytics adapters: `jsonwebtoken`, `jwks-rsa`, `@aws-sdk/client-cognito-identity-provider`, `@google-cloud/bigquery`, and DynamoDB document clients (`@aws-sdk/lib-dynamodb` + `aws-sdk` v2 `DocumentClient`)
- HTTP/provider enrichment: axios interceptor hooks plus URL-based provider classification (Twilio, WhatsApp Business API, OpenAI, Deepgram, Gemini, Firebase, GCS, BigQuery, DynamoDB, Cognito, Google APIs, VPS Platform, Halo Functions)
- Storage adapter: `@google-cloud/storage` common bucket/file operations

## Why it is app-safe

- Non-blocking event enqueue on app path
- Background flush timer
- Batching to `/v1/events/batch`
- Short network timeout for sender
- Bounded queue (`queueMaxEvents`) to prevent memory blowups
- Drop policy when queue/sender overloaded (app speed first)

## Defaults

- `queueMaxEvents`: `10000`
- `batchSize`: `250`
- `flushIntervalMs`: `500`
- `requestTimeoutMs`: `400`
- `maxConcurrentFlushes`: `2`
- `maxPayloadBytes`: `1048576`
- `sampleSuccessRate`: `1` (no success sampling)
- `runtimeMetricsIntervalMs`: `0` (disabled by default)

## Optional tuning

```js
initTelemetryDiscovery({
  appName: "genesis",
  endpoint: process.env.HALO_TELEMETRY_URL,
  token: process.env.HALO_TELEMETRY_TOKEN,
  queueMaxEvents: 15000,
  batchSize: 500,
  flushIntervalMs: 250,
  requestTimeoutMs: 300,
  sampleSuccessRate: 0.25
});
```
