import type { NextFunction, Request, Response } from 'express';
import { config } from '../config';

function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function trustedBrowserOrigins(): Set<string> {
  return new Set([config.clientUrl, config.productionUrl]
    .filter(Boolean)
    .map(normalizeOrigin)
    .filter((value): value is string => Boolean(value)));
}

export function isTrustedBrowserOrigin(origin: string): boolean {
  const normalized = normalizeOrigin(origin);
  return Boolean(normalized && trustedBrowserOrigins().has(normalized));
}

export function requireTrustedJsonMutation(req: Request, res: Response, next: NextFunction): void {
  if (!req.is('application/json')) {
    res.status(415).json({ error: 'Content-Type application/json is required.' });
    return;
  }
  const origin = req.get('origin');
  if (!origin) {
    if (config.isProduction) {
      res.status(403).json({ error: 'A trusted request origin is required.' });
      return;
    }
    next();
    return;
  }
  if (!isTrustedBrowserOrigin(origin)) {
    res.status(403).json({ error: 'Request origin is not allowed.' });
    return;
  }
  next();
}
