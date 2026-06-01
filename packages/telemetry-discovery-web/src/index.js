const SDK_VERSION = "0.1.0";

export function initTelemetryDiscoveryWeb(config) {
  const resolved = resolveConfig(config);
  const sender = new BrowserBufferedSender(resolved);
  const state = {
    config: resolved,
    sender,
    unpatchFns: []
  };

  patchFetch(state);
  patchXhr(state);
  patchErrors(state);
  patchNavigation(state);
  patchInteractions(state);
  trackPageView(state, "initial_load");

  return {
    track: (rawPayload, options = {}) => trackRawEvent(state, rawPayload, options),
    flush: () => sender.flush(),
    shutdown: () => {
      for (const fn of state.unpatchFns) {
        try {
          fn();
        } catch {
          // noop
        }
      }
      return sender.flush();
    },
    getStats: () => ({ ...sender.stats })
  };
}

function resolveConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("initTelemetryDiscoveryWeb requires a config object");
  }

  const appName = nonEmptyString(config.appName);
  const endpoint = nonEmptyString(config.endpoint).replace(/\/+$/, "");
  const token = nonEmptyString(config.token);

  return {
    appName,
    endpoint,
    token,
    performance: {
      queueMaxEvents: numberOrDefault(config.queueMaxEvents, 5000),
      batchSize: numberOrDefault(config.batchSize, 100),
      flushIntervalMs: numberOrDefault(config.flushIntervalMs, 750),
      requestTimeoutMs: numberOrDefault(config.requestTimeoutMs, 500),
      maxPayloadBytes: numberOrDefault(config.maxPayloadBytes, 512 * 1024),
      sampleSuccessRate: numberOrDefault(config.sampleSuccessRate, 1)
    }
  };
}

function trackRawEvent(state, rawPayload, options = {}) {
  const payload = sanitizePayload(rawPayload, state.config.performance.maxPayloadBytes);
  const shouldSample = options.forceKeep !== true && sampleDrop(payload, state.config.performance.sampleSuccessRate);
  if (shouldSample) {
    return false;
  }

  const event = {
    event_id: crypto.randomUUID(),
    app_name: state.config.appName,
    raw_payload: {
      ...payload,
      sdk_version: SDK_VERSION,
      captured_at: new Date().toISOString(),
      page_url: location.href
    }
  };

  state.sender.enqueue(event);
  return true;
}

function patchFetch(state) {
  if (typeof window.fetch !== "function") {
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function telemetryWrappedFetch(input, init) {
    const startedAt = performance.now();
    const method = (init?.method ?? "GET").toUpperCase();
    const url = typeof input === "string" ? input : input?.url ?? "unknown";
    if (isTelemetryEndpointCall(state, url)) {
      return originalFetch(input, init);
    }

    try {
      const response = await originalFetch(input, init);
      trackRawEvent(
        state,
        {
          type: "frontend_api_call",
          layer: "fetch",
          method,
          url,
          status_code: response.status,
          success: response.ok,
          duration_ms: Math.round(performance.now() - startedAt)
        },
        { forceKeep: !response.ok }
      );
      return response;
    } catch (error) {
      trackRawEvent(
        state,
        {
          type: "frontend_api_call",
          layer: "fetch",
          method,
          url,
          success: false,
          duration_ms: Math.round(performance.now() - startedAt),
          error_message: stringError(error)
        },
        { forceKeep: true }
      );
      throw error;
    }
  };

  state.unpatchFns.push(() => {
    window.fetch = originalFetch;
  });
}

function patchXhr(state) {
  if (typeof window.XMLHttpRequest !== "function") {
    return;
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function telemetryOpen(method, url, ...rest) {
    this.__telemetryMeta = { method: String(method).toUpperCase(), url: String(url), startedAt: 0 };
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function telemetrySend(body) {
    const meta = this.__telemetryMeta ?? { method: "GET", url: "unknown" };
    meta.startedAt = performance.now();
    this.addEventListener("loadend", () => {
      if (isTelemetryEndpointCall(state, meta.url)) {
        return;
      }
      const duration = Math.round(performance.now() - (meta.startedAt ?? performance.now()));
      const success = this.status >= 200 && this.status < 400;
      trackRawEvent(
        state,
        {
          type: "frontend_api_call",
          layer: "xhr",
          method: meta.method,
          url: meta.url,
          status_code: this.status,
          success,
          duration_ms: duration,
          request_body_size_bytes: typeof body === "string" ? body.length : undefined
        },
        { forceKeep: !success }
      );
    });
    return originalSend.call(this, body);
  };

  state.unpatchFns.push(() => {
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
  });
}

function patchInteractions(state) {
  const onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const clickable = target.closest("button, a, [role='button'], input, label, [data-telemetry-id]");
    if (!clickable) {
      return;
    }

    trackRawEvent(state, {
      type: "frontend_click",
      success: true,
      element_tag: clickable.tagName.toLowerCase(),
      element_id: clickable.id || null,
      element_role: clickable.getAttribute("role"),
      element_text: truncateText(clickable.textContent?.trim() ?? "", 120),
      telemetry_id: clickable.getAttribute("data-telemetry-id"),
      path: location.pathname
    });
  };

  document.addEventListener("click", onClick, { passive: true, capture: true });
  state.unpatchFns.push(() => {
    document.removeEventListener("click", onClick, { capture: true });
  });
}

function patchErrors(state) {
  const onError = (event) => {
    trackRawEvent(
      state,
      {
        type: "frontend_error",
        category: "window_error",
        success: false,
        message: event.message,
        source: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      },
      { forceKeep: true }
    );
  };

  const onUnhandledRejection = (event) => {
    trackRawEvent(
      state,
      {
        type: "frontend_error",
        category: "unhandled_rejection",
        success: false,
        message: stringError(event.reason)
      },
      { forceKeep: true }
    );
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  state.unpatchFns.push(() => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  });
}

function patchNavigation(state) {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function telemetryPushState(...args) {
    const out = originalPushState.apply(this, args);
    trackPageView(state, "push_state");
    return out;
  };

  history.replaceState = function telemetryReplaceState(...args) {
    const out = originalReplaceState.apply(this, args);
    trackPageView(state, "replace_state");
    return out;
  };

  const onPopState = () => trackPageView(state, "pop_state");
  const onVisibilityChange = () => {
    trackRawEvent(state, {
      type: "frontend_visibility",
      success: true,
      visibility_state: document.visibilityState
    });
  };

  window.addEventListener("popstate", onPopState);
  document.addEventListener("visibilitychange", onVisibilityChange);

  state.unpatchFns.push(() => {
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
    window.removeEventListener("popstate", onPopState);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  });
}

function trackPageView(state, reason) {
  trackRawEvent(state, {
    type: "frontend_page_view",
    success: true,
    reason,
    path: location.pathname,
    query: location.search
  });
}

class BrowserBufferedSender {
  constructor(config) {
    this.config = config;
    this.queue = [];
    this.timer = null;
    this.flushing = false;
    this.stats = {
      enqueued: 0,
      sent: 0,
      dropped_queue_full: 0,
      dropped_sender_error: 0,
      flush_errors: 0
    };
  }

  enqueue(event) {
    if (this.queue.length >= this.config.performance.queueMaxEvents) {
      this.stats.dropped_queue_full += 1;
      return;
    }
    this.queue.push(event);
    this.stats.enqueued += 1;
    this.schedule();
  }

  schedule() {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, this.config.performance.flushIntervalMs);
  }

  async flush() {
    if (this.flushing) {
      return;
    }
    const batch = this.queue.splice(0, this.config.performance.batchSize);
    if (batch.length === 0) {
      return;
    }

    this.flushing = true;
    try {
      await sendBatch(this.config, batch);
      this.stats.sent += batch.length;
    } catch {
      this.stats.flush_errors += 1;
      this.stats.dropped_sender_error += batch.length;
    } finally {
      this.flushing = false;
      if (this.queue.length > 0) {
        this.schedule();
      }
    }
  }
}

async function sendBatch(config, events) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.performance.requestTimeoutMs);
  try {
    const response = await fetch(`${config.endpoint}/v1/events/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`
      },
      body: JSON.stringify({ events }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`batch send failed: ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizePayload(payload, maxPayloadBytes) {
  const base = payload && typeof payload === "object" ? payload : { value: payload };
  const encoded = JSON.stringify(base);
  const size = encoded.length;
  if (size <= maxPayloadBytes) {
    return base;
  }
  return {
    truncated: true,
    original_size_bytes: size,
    preview: encoded.slice(0, maxPayloadBytes)
  };
}

function sampleDrop(payload, sampleSuccessRate) {
  if (sampleSuccessRate >= 1) {
    return false;
  }
  return payload?.success === true && Math.random() > sampleSuccessRate;
}

function nonEmptyString(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("Missing required non-empty string config value");
  }
  return value.trim();
}

function numberOrDefault(value, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return fallback;
  }
  return value;
}

function stringError(error) {
  if (!error) {
    return "unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  return error.message ?? JSON.stringify(error);
}

function isTelemetryEndpointCall(state, urlLike) {
  if (!urlLike || typeof urlLike !== "string") {
    return false;
  }

  try {
    const target = new URL(urlLike, location.origin);
    const ingest = new URL(state.config.endpoint);
    return target.origin === ingest.origin && target.pathname.startsWith("/v1/events");
  } catch {
    return false;
  }
}

function truncateText(value, maxLen) {
  if (!value) {
    return value;
  }
  if (value.length <= maxLen) {
    return value;
  }
  return `${value.slice(0, maxLen)}...`;
}
