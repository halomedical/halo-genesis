import fs from 'fs';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

const DEV_GOOGLE_TOKENS_FILE = path.join(
  process.cwd(),
  'test-data/.dev-google-tokens.json'
);

function cacheDevGoogleTokens(accessToken: string, refreshToken: string | undefined, expiresIn: number): void {
  if (config.isProduction) return;
  try {
    fs.mkdirSync(path.dirname(DEV_GOOGLE_TOKENS_FILE), { recursive: true });
    let existingRefresh: string | null = null;
    if (fs.existsSync(DEV_GOOGLE_TOKENS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DEV_GOOGLE_TOKENS_FILE, 'utf8')) as {
        refresh_token?: string | null;
      };
      existingRefresh = raw.refresh_token ?? null;
    }
    fs.writeFileSync(
      DEV_GOOGLE_TOKENS_FILE,
      JSON.stringify(
        {
          access_token: accessToken,
          refresh_token: refreshToken ?? existingRefresh,
          expires_at: Date.now() + expiresIn * 1000,
          cached_at: new Date().toISOString(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch {
    // non-fatal
  }
}

// Extend express-session to include our custom fields
declare module 'express-session' {
  interface SessionData {
    accessToken?: string;
    refreshToken?: string;
    tokenExpiry?: number;
    userEmail?: string;
    userName?: string;
    vpsJwt?: string;
    appPersona?: 'clinician' | 'admin_staff';
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!req.session.accessToken) {
    res.status(401).json({ error: 'Not authenticated. Please sign in.' });
    return;
  }

  // Check if token has expired and refresh if possible
  if (req.session.tokenExpiry && Date.now() >= req.session.tokenExpiry) {
    if (req.session.refreshToken) {
      try {
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: config.googleClientId,
            client_secret: config.googleClientSecret,
            refresh_token: req.session.refreshToken,
            grant_type: 'refresh_token',
          }),
        });

        const tokens = (await tokenResponse.json()) as {
          access_token?: string;
          expires_in?: number;
          error?: string;
        };

        if (tokens.error || !tokens.access_token) {
          req.session.destroy(() => {});
          res.status(401).json({ error: 'Session expired. Please sign in again.' });
          return;
        }

        req.session.accessToken = tokens.access_token;
        req.session.tokenExpiry = Date.now() + (tokens.expires_in ?? 3600) * 1000;
        cacheDevGoogleTokens(tokens.access_token, req.session.refreshToken, tokens.expires_in ?? 3600);
      } catch {
        req.session.destroy(() => {});
        res.status(401).json({ error: 'Failed to refresh session. Please sign in again.' });
        return;
      }
    } else {
      req.session.destroy(() => {});
      res.status(401).json({ error: 'Session expired. Please sign in again.' });
      return;
    }
  }

  next();
};
