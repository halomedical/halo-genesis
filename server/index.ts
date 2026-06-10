import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import path from 'path';
import http from 'http';
import { config } from './config';
import authRoutes from './routes/auth';
import driveRoutes from './routes/drive';
import aiRoutes from './routes/ai';
import haloRoutes from './routes/halo';
import calendarRoutes from './routes/calendar';
import requestTemplateRoutes from './routes/requestTemplate';
import adminAgentRoutes from './routes/adminAgent';
import pdfFillerRoutes from './routes/pdfFiller';
import { requireFeature } from './middleware/requireFeature';
import { pdfFillerHealthCheck } from './services/pdfFillerClient';
import { attachTranscribeWebSocket } from './ws/transcribe';
// Conversion scheduler disabled — was running in background for txt→docx→pdf
// import { startScheduler } from './jobs/scheduler';
import { startAutomationRunner } from './jobs/automationRunner';


const app = express();

// Trust Heroku proxy so rate limiting sees the real client IP
if (config.isProduction) {
  app.set('trust proxy', 1);
}

// --- Global Rate Limiter ---
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // 300 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// --- AI Route Rate Limiter (stricter) ---
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 AI requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI rate limit reached. Please wait before trying again.' },
});

// --- Auth Rate Limiter (prevent brute force) ---
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please try again later.' },
});

// --- MIDDLEWARE ---
app.use(globalLimiter);
app.use(cors({
  // In production, allow same-origin requests and also accept any *.herokuapp.com
  // origin so the app works regardless of how CLIENT_URL is configured.
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin or non-browser
    if (!config.isProduction) return cb(null, origin === config.clientUrl);
    const allowed =
      origin === config.clientUrl ||
      /^https:\/\/[a-z0-9-]+\.herokuapp\.com$/.test(origin) ||
      origin === config.productionUrl;
    cb(null, allowed ? origin : false);
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.isProduction,
    httpOnly: true,
    sameSite: config.isProduction ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// --- ROUTES ---
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/halo', aiLimiter, haloRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/request-template', requestTemplateRoutes);
app.use('/api/admin-agent', requireFeature('adminAgent'), adminAgentRoutes);
app.use('/api/pdf-filler', requireFeature('pdfFiller'), pdfFillerRoutes);

// Health check — returns server + dependency configuration status
app.get('/api/health', async (_req: Request, res: Response) => {
  const sidecarOk = await pdfFillerHealthCheck();
  const checks: Record<string, 'ok' | 'unconfigured'> = {
    server: 'ok',
    gemini: config.geminiApiKey ? 'ok' : 'unconfigured',
    deepgram: config.deepgramApiKey ? 'ok' : 'unconfigured',
    haloApi: config.haloApiBaseUrl ? 'ok' : 'unconfigured',
    smtp: (config.smtpHost && config.smtpUser) ? 'ok' : 'unconfigured',
    pdfFillerSidecar: sidecarOk ? 'ok' : 'unconfigured',
  };
  const allOk = Object.values(checks).every(v => v === 'ok');
  res.status(allOk ? 200 : 207).json({
    status: allOk ? 'ok' : 'partial',
    timestamp: new Date().toISOString(),
    checks,
  });
});

// Serve frontend in production
if (config.isProduction) {
  const staticPath = path.join(process.cwd(), 'src', 'shell', 'dist');
  app.use(express.static(staticPath));
  app.get('/{*splat}', (_req: Request, res: Response) => {
    res.sendFile('index.html', { root: staticPath });
  });
}

// --- Global Error Handler ---
app.use((err: Error & { status?: number; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status ?? err.statusCode ?? 500;
  const message = status < 500
    ? err.message
    : 'Something went wrong on our end. Please try again.';
  console.error(`[${status}] Unhandled error: ${err.message}`);
  res.status(status).json({ error: message });
});

const server = http.createServer(app);
attachTranscribeWebSocket(server);

server.listen(config.port, () => {
  console.log(`Halo server running on port ${config.port} (${config.isProduction ? 'production' : 'development'})`);
  startAutomationRunner();
});
