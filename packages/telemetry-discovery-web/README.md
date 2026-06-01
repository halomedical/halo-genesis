# @halo/telemetry-discovery-web

Maximal discovery SDK for browser/React apps.

## Install

```bash
npm install ../telemetry-endpoint/packages/telemetry-discovery-web
```

## One-line startup

```js
import { initTelemetryDiscoveryWeb } from "@halo/telemetry-discovery-web";

const telemetry = initTelemetryDiscoveryWeb({
  appName: "halo-scribe-frontend",
  endpoint: import.meta.env.VITE_HALO_TELEMETRY_URL,
  token: import.meta.env.VITE_HALO_TELEMETRY_TOKEN
});
```

## Auto-hooks included

- `fetch` outbound calls
- `XMLHttpRequest` outbound calls
- `window.onerror` + unhandled promise rejections
- navigation tracking (`pushState`, `replaceState`, `popstate`)
- visibility changes
- click interactions (`button`, `a`, inputs, role=button, telemetry-tagged elements)

## Performance-safe behavior

- non-blocking enqueue on UI path
- background batch sender to `/v1/events/batch`
- short network timeout
- bounded queue + drop-on-overload
- payload truncation cap
