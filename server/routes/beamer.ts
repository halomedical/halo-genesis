import express, { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { requireAuth } from '../middleware/requireAuth';
import { requireFeature } from '../middleware/requireFeature';
import { BeamerError, getBeamerService } from '../services/beamer';
import { getPracticeEntitlementsForEmail } from '../services/practiceEntitlements';
import { requireTrustedJsonMutation } from '../security/trustedOrigins';
import { isSafeInstallerReleaseUrl } from '../services/beamerValidation';

const router = Router();
const protectedRoute = [requireAuth, requireFeature('beamer')];
const enrollmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many enrollment attempts. Please try again later.' },
});

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : value || '';
}

function bearerToken(req: Request): string {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function practiceContext(req: Request) {
  const userEmail = req.session.userEmail || '';
  const entitlements = await getPracticeEntitlementsForEmail(userEmail);
  if (!entitlements.practice) throw new BeamerError('Practice membership is required.', 403);
  return { practice: entitlements.practice, userEmail, accessRole: entitlements.accessRole };
}

function requirePracticeAdmin(accessRole: string): void {
  if (accessRole !== 'owner' && accessRole !== 'admin') {
    throw new BeamerError('Practice owner or administrator access is required.', 403);
  }
}

function header(req: Request, name: string): string {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function handle(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof BeamerError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  next(error);
}

router.get('/overview', ...protectedRoute, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { practice } = await practiceContext(req);
    res.json(await getBeamerService().overview(practice));
  } catch (error) { handle(error, res, next); }
});

router.get('/windows-installer/manifest', (_req: Request, res: Response) => {
  const valid = isSafeInstallerReleaseUrl(config.beamerWindowsInstallerUrl) &&
    /^[A-F0-9]{64}$/.test(config.beamerWindowsInstallerSha256) &&
    Boolean(config.beamerWindowsInstallerVersion);
  if (!valid) {
    res.status(503).json({ error: 'The Beamer for Windows release is not configured.' });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    contractVersion: 1,
    productName: 'Beamer for Windows',
    version: config.beamerWindowsInstallerVersion,
    downloadUrl: config.beamerWindowsInstallerUrl,
    sha256: config.beamerWindowsInstallerSha256,
    supportedArchitectures: ['x64'],
    minimumWindowsVersion: '10',
    enrollmentEndpoint: '/api/beamer/agent/enroll',
  });
});

router.get('/windows-installer/bootstrap', (_req: Request, res: Response) => {
  const bootstrapPath = path.resolve(process.cwd(), 'services', 'heimdall', 'installer', 'bootstrap.ps1');
  if (!fs.existsSync(bootstrapPath)) {
    res.status(404).type('text/plain').send('The Beamer bootstrap script is unavailable.');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type('text/plain').send(fs.readFileSync(bootstrapPath, 'utf8'));
});

router.post('/onboarding/start', requireTrustedJsonMutation, ...protectedRoute, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { practice, userEmail, accessRole } = await practiceContext(req);
    requirePracticeAdmin(accessRole);
    res.json(await getBeamerService().startOnboarding({
      practice,
      userEmail,
      replaceDevice: req.body?.replaceDevice === true,
    }));
  } catch (error) { handle(error, res, next); }
});

router.post('/mobile/uploads', requireTrustedJsonMutation, ...protectedRoute, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { practice, userEmail } = await practiceContext(req);
    const files = Array.isArray(req.body?.files) ? req.body.files.map((file: unknown) => {
      const value = file && typeof file === 'object' ? file as Record<string, unknown> : {};
      return {
        clientId: String(value.clientId || ''),
        mimeType: String(value.mimeType || ''),
        size: Number(value.size),
        data: String(value.data || ''),
      };
    }) : [];
    res.status(201).json(await getBeamerService().uploadMobile({
      practiceId: practice.id,
      userEmail,
      patientId: String(req.body?.patientId || '').trim(),
      files,
    }));
  } catch (error) { handle(error, res, next); }
});

router.patch('/review/:uploadId', requireTrustedJsonMutation, ...protectedRoute, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { practice, userEmail, accessRole } = await practiceContext(req);
    requirePracticeAdmin(accessRole);
    res.json(await getBeamerService().review(
      practice.id,
      routeParam(req.params.uploadId),
      {
        action: req.body?.action,
        patientId: req.body?.patientId,
        // Accepted for UI compatibility but deliberately not persisted; patientId is authoritative.
        patientName: req.body?.patientName,
      },
      userEmail
    ));
  } catch (error) { handle(error, res, next); }
});

router.get('/patients/:patientId/assets', ...protectedRoute, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.query.status !== undefined && req.query.status !== 'approved') {
      throw new BeamerError('Only approved assets are available to Scopes.', 400);
    }
    const { practice } = await practiceContext(req);
    res.json(await getBeamerService().approvedAssets(practice.id, routeParam(req.params.patientId)));
  } catch (error) { handle(error, res, next); }
});

router.get('/assets/:assetId/content', ...protectedRoute, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { practice } = await practiceContext(req);
    const content = await getBeamerService().assetContent(practice.id, routeParam(req.params.assetId));
    res.setHeader('Content-Type', content.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Content-Disposition', 'inline; filename="beamer-image"');
    res.send(content.bytes);
  } catch (error) { handle(error, res, next); }
});

// Agent endpoints authenticate with the issued device credential, never a browser session.
router.post('/agent/enroll', enrollmentLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json(await getBeamerService().enrollDevice({
      contractVersion: Number(req.body?.contractVersion),
      enrollmentToken: String(req.body?.enrollmentToken || ''),
      installationId: String(req.body?.installationId || ''),
      displayName: String(req.body?.displayName || ''),
      agentVersion: req.body?.agentVersion,
    }));
  } catch (error) { handle(error, res, next); }
});

router.post('/agent/heartbeat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await getBeamerService().heartbeat(bearerToken(req), {
      contractVersion: req.body?.contractVersion,
      agentVersion: req.body?.agentVersion,
      configSchemaVersion: req.body?.configSchemaVersion,
      lastSyncedAt: req.body?.lastSyncedAt,
      pendingUploadCount: req.body?.pendingUploadCount,
      pendingReviewCount: req.body?.pendingReviewCount,
    }));
  } catch (error) { handle(error, res, next); }
});

router.post(
  '/agent/files/:uploadId',
  express.raw({ type: ['application/octet-stream', 'image/*'], limit: config.beamerMaxFileUploadBytes }),
  async (req: Request, res: Response, next: NextFunction) => {
  try {
    const declaredLength = Number(header(req, 'content-length'));
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 1 || declaredLength !== bytes.length) {
      throw new BeamerError('A correct Content-Length header is required.', 400);
    }
    const mimeType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    res.status(201).json(await getBeamerService().uploadAgentFile(bearerToken(req), {
      uploadId: routeParam(req.params.uploadId),
      patientId: header(req, 'x-beamer-patient-id') || null,
      mimeType,
      bytes,
      capturedAt: header(req, 'x-beamer-capture-time') || undefined,
      reviewStatus: header(req, 'x-beamer-review-status') || undefined,
      reviewReasonCode: header(req, 'x-beamer-review-reason') || undefined,
    }));
  } catch (error) { handle(error, res, next); }
  }
);

export default router;
