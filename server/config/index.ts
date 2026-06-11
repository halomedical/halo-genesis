import dotenv from 'dotenv';

dotenv.config();

// --- Required Environment Variables ---
const REQUIRED_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GEMINI_API_KEY', 'SESSION_SECRET'] as const;

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

/** Railway UI often copies host only; Node fetch requires a scheme. */
function normalizePdfFillerServiceUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) {
    return `http://${trimmed}`;
  }
  return `https://${trimmed}`;
}

// --- Validated Config Export ---
export const config = {
  // Google OAuth
  googleClientId: process.env.GOOGLE_CLIENT_ID!,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET!,

  // AI
  geminiApiKey: process.env.GEMINI_API_KEY!,
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || '',

  // Session
  sessionSecret: process.env.SESSION_SECRET!,

  // Server
  port: Number(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // URLs
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  productionUrl: process.env.PRODUCTION_URL || '',

  // Drive API
  driveApi: 'https://www.googleapis.com/drive/v3',
  uploadApi: 'https://www.googleapis.com/upload/drive/v3',

  // Google Calendar API
  calendarApi: 'https://www.googleapis.com/calendar/v3',
  bookingsCalendarId: process.env.BOOKINGS_CALENDAR_ID || 'primary',

  // VPS Platform API
  vpsBaseUrl: process.env.VPS_BASE_URL || 'https://platform.halo.africa',
  vpsAdminEmail: process.env.VPS_ADMIN_EMAIL || '',
  vpsAdminPassword: process.env.VPS_ADMIN_PASSWORD || '',

  // Halo Functions API
  haloApiBaseUrl: process.env.HALO_API_BASE_URL || 'https://halo-functions-75316778879.africa-south1.run.app',
  haloUserId: process.env.HALO_USER_ID || 'cae6877e-0fbe-4ea1-acce-39957e7575bc',
  // Mobile app: fixed user/template for dictation flow
  haloMobileUserId: process.env.HALO_MOBILE_USER_ID || 'fcb5cfec-e10e-4c3a-bd44-064a788a6243',
  haloMobileTemplateId: process.env.HALO_MOBILE_TEMPLATE_ID || 'report',

  // Template request email (optional)
  adminEmail: process.env.ADMIN_EMAIL || 'admin@halo.africa',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: process.env.SMTP_SECURE === 'true',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',

  // PDF Filler Python sidecar (Layer C) — pdf-mapper-endpoint on Railway
  pdfFillerServiceUrl: normalizePdfFillerServiceUrl(
    process.env.PDF_FILLER_SERVICE_URL ||
      'https://pdf-mapper-endpoint-production.up.railway.app'
  ),
  pdfFillerServiceSecret:
    process.env.PDF_FILLER_SERVICE_SECRET ||
    process.env.PDF_FILLER_SECRET_KEY ||
    '',

  // Global PDF layout cache (no PHI)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
} as const;
