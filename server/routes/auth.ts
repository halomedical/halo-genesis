import fs from 'fs';
import path from 'path';
import { Router, Request, Response } from 'express';
import { config } from '../config';
import { getHaloRootFolder } from '../services/drive';

const DEV_GOOGLE_TOKENS_FILE = path.join(
  process.cwd(),
  'test-data/.dev-google-tokens.json'
);

function cacheDevGoogleTokens(tokens: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}): void {
  if (config.isProduction) return;
  try {
    fs.mkdirSync(path.dirname(DEV_GOOGLE_TOKENS_FILE), { recursive: true });
    fs.writeFileSync(
      DEV_GOOGLE_TOKENS_FILE,
      JSON.stringify(
        {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? null,
          expires_at: Date.now() + (tokens.expires_in ?? 3600) * 1000,
          cached_at: new Date().toISOString(),
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
  } catch (err) {
    console.warn('[auth] Failed to cache dev Google tokens:', err);
  }
}

const router = Router();

const getRedirectUri = (req?: Request): string => {
  if (config.isProduction) {
    // Use the actual request host so the redirect URI always matches
    // the URL the user is on, regardless of how PRODUCTION_URL is configured.
    const host = req?.headers?.host ?? config.productionUrl.replace(/^https?:\/\//, '');
    return `https://${host}/api/auth/callback`;
  }
  return `http://localhost:${config.port}/api/auth/callback`;
};

router.get('/login-url', (_req: Request, res: Response) => {
  if (!config.googleClientId) {
    res.status(500).json({ error: 'Server misconfigured: missing Google Client ID.' });
    return;
  }

  const scopes = [
    // Full Drive access for patient folders and files
    'https://www.googleapis.com/auth/drive',
    // Read/write access for bookings calendar events (two-way sync)
    'https://www.googleapis.com/auth/calendar.events',
    // Gmail read/send for Admin Agent email monitoring and drafting
    'https://www.googleapis.com/auth/gmail.modify',
    'openid',
    'email',
    'profile',
  ].join(' ');

  const redirectUri = getRedirectUri(_req);

  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    `client_id=${config.googleClientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  res.json({ url });
});

router.get('/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing or invalid authorization code.' });
    return;
  }

  try {
    const redirectUri = getRedirectUri(req);

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = (await tokenResponse.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (tokens.error || !tokens.access_token) {
      console.error('Token exchange error:', tokens);
      res.status(400).json({ error: tokens.error_description || 'Token exchange failed.' });
      return;
    }

    // Store tokens in session
    req.session.accessToken = tokens.access_token;
    if (tokens.refresh_token) {
      req.session.refreshToken = tokens.refresh_token;
    }
    req.session.tokenExpiry = Date.now() + (tokens.expires_in ?? 3600) * 1000;
    cacheDevGoogleTokens({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
    });

    // Fetch user info
    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const user = (await userInfoRes.json()) as { email?: string };
    req.session.userEmail = user.email;

    console.log(`User signed in: ${user.email}`);

    // Register Google tokens on VPS and get a VPS JWT (runs in background — no await)
    fetch(`${process.env.VPS_BASE_URL || 'https://platform.halo.africa'}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        google_access_token: tokens.access_token,
        google_refresh_token: tokens.refresh_token ?? req.session.refreshToken ?? '',
        email: user.email,
        name: (user as { name?: string }).name,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        const d = data as { access_token?: string };
        if (d.access_token) {
          req.session.vpsJwt = d.access_token;
          req.session.save(() => {});
        }
      })
      .catch((err) => console.error('VPS google auth error:', err));

    // Ensure Halo root folder exists in Drive (runs in background — no await)
    getHaloRootFolder(tokens.access_token!).catch(() => {});

    // Save session before redirecting so the cookie is written first.
    // In production the server serves the React app, so redirect to root.
    // In development redirect to the Vite dev server.
    const redirectTarget = config.isProduction ? '/' : config.clientUrl;
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save error:', saveErr);
        res.status(500).json({ error: 'Authentication failed. Please try again.' });
        return;
      }
      res.redirect(redirectTarget);
    });
  } catch (err) {
    console.error('Auth callback error:', err);
    res.status(500).json({ error: 'Authentication failed. Please try again.' });
  }
});

router.get('/me', (req: Request, res: Response) => {
  if (req.session.accessToken) {
    res.json({
      signedIn: true,
      email: req.session.userEmail,
      name: req.session.userName,
      appPersona: req.session.appPersona ?? null,
    });
  } else {
    res.json({ signedIn: false });
  }
});

router.post('/persona', (req: Request, res: Response) => {
  if (!req.session.accessToken) {
    res.status(401).json({ error: 'Not authenticated. Please sign in.' });
    return;
  }

  if (req.session.appPersona) {
    res.status(403).json({ error: 'Workspace already selected. Sign out to choose a different role.' });
    return;
  }

  const persona = req.body?.persona;
  if (persona !== 'clinician' && persona !== 'admin_staff') {
    res.status(400).json({ error: 'persona must be "clinician" or "admin_staff".' });
    return;
  }

  req.session.appPersona = persona;
  req.session.save((saveErr) => {
    if (saveErr) {
      console.error('Session save error (persona):', saveErr);
      res.status(500).json({ error: 'Could not save workspace selection.' });
      return;
    }
    res.json({ ok: true, appPersona: persona });
  });
});

router.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

export default router;
