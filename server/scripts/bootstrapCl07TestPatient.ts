/**
 * Create CL07 autofill test patient in Google Drive (no browser session required).
 *
 * Usage:
 *   GOOGLE_REFRESH_TOKEN=... npx ts-node server/scripts/bootstrapCl07TestPatient.ts
 *   npx ts-node server/scripts/bootstrapCl07TestPatient.ts --code=AUTH_CODE_FROM_CALLBACK
 */
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import {
  driveRequest,
  findFileInFolder,
  getHaloRootFolder,
  upsertTextFileInFolder,
} from '../services/drive';

const PATIENT = {
  name: 'Margaret Thandi Ndlovu',
  dob: '1987-03-14',
  sex: 'F' as const,
  medicalAid: 'Discovery Health',
  medicalAidPlan: 'Classic Comprehensive',
  medicalAidNumber: '4829103756',
  memberNumber: '4829103756',
  dependantCode: '00',
  idNumber: '8703140583087',
  schemeCode: 'DISC',
  planCode: 'CCOMP',
  initials: 'MT',
  statusIndicator: 'A',
  folderNumber: 'CL07-TEST-001',
};

const SUMMARY_PATH = path.join(
  process.cwd(),
  'test-data/pdf-autofill-cl07/Margaret_Ndlovu__1987-03-14__F/patient-summary.md'
);

async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) {
    throw new Error(data.error || 'Failed to refresh Google access token.');
  }
  return data.access_token;
}

async function accessTokenFromCode(code: string): Promise<string> {
  const redirectUri = `http://localhost:${config.port}/api/auth/callback`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
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
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(data.error_description || data.error || 'Token exchange failed.');
  }
  if (data.refresh_token) {
    const tokenFile = path.join(process.cwd(), 'test-data/pdf-autofill-cl07/.google-refresh-token');
    fs.writeFileSync(tokenFile, `${data.refresh_token.trim()}\n`, { mode: 0o600 });
    console.log(`Saved refresh token to ${tokenFile} for future runs.`);
  }
  return data.access_token;
}

async function tokenFromDevCache(): Promise<string | null> {
  const cachePath = path.join(process.cwd(), 'test-data/.dev-google-tokens.json');
  if (!fs.existsSync(cachePath)) return null;
  const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as {
    access_token?: string;
    refresh_token?: string | null;
    expires_at?: number;
  };
  if (raw.access_token && raw.expires_at && Date.now() < raw.expires_at - 60_000) {
    return raw.access_token;
  }
  if (raw.refresh_token) {
    const access = await accessTokenFromRefresh(raw.refresh_token);
    cacheDevTokens(access, raw.refresh_token, 3600);
    return access;
  }
  return null;
}

function cacheDevTokens(accessToken: string, refreshToken: string | null, expiresIn: number): void {
  const cachePath = path.join(process.cwd(), 'test-data/.dev-google-tokens.json');
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(
    cachePath,
    JSON.stringify(
      {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Date.now() + expiresIn * 1000,
        cached_at: new Date().toISOString(),
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
}

async function resolveAccessToken(): Promise<string> {
  const codeArg = process.argv.find((a) => a.startsWith('--code='))?.split('=')[1];
  if (codeArg) return accessTokenFromCode(codeArg.trim());

  const fromDev = await tokenFromDevCache();
  if (fromDev) return fromDev;

  const envRefresh = process.env.GOOGLE_REFRESH_TOKEN?.trim();
  if (envRefresh) return accessTokenFromRefresh(envRefresh);

  const tokenFile = path.join(process.cwd(), 'test-data/pdf-autofill-cl07/.google-refresh-token');
  if (fs.existsSync(tokenFile)) {
    const fromFile = fs.readFileSync(tokenFile, 'utf8').trim();
    if (fromFile) return accessTokenFromRefresh(fromFile);
  }

  throw new Error(
    'No Google credentials. Sign in once at http://localhost:5173 (dev caches tokens), set GOOGLE_REFRESH_TOKEN, or pass --code= from OAuth callback.'
  );
}

async function main(): Promise<void> {
  const token = await resolveAccessToken();
  const markdown = fs.readFileSync(SUMMARY_PATH, 'utf8');
  const rootId = await getHaloRootFolder(token);

  const folder = (await driveRequest(token, '/files', {
    method: 'POST',
    body: JSON.stringify({
      name: `${PATIENT.name}__${PATIENT.dob}__${PATIENT.sex}`,
      parents: [rootId],
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: {
        type: 'patient_folder',
        patientName: PATIENT.name,
        patientDob: PATIENT.dob,
        patientSex: PATIENT.sex,
        medicalAid: PATIENT.medicalAid,
        medicalAidPlan: PATIENT.medicalAidPlan,
        medicalAidNumber: PATIENT.medicalAidNumber,
        memberNumber: PATIENT.memberNumber,
        dependantCode: PATIENT.dependantCode,
        idNumber: PATIENT.idNumber,
        schemeCode: PATIENT.schemeCode,
        planCode: PATIENT.planCode,
        initials: PATIENT.initials,
        statusIndicator: PATIENT.statusIndicator,
        folderNumber: PATIENT.folderNumber,
      },
    }),
  })) as { id: string };

  const folderId = folder.id;
  const stub = await findFileInFolder(token, folderId, '_Summary.md');
  if (stub) {
    await driveRequest(token, `/files/${stub.id}`, { method: 'DELETE' });
  }

  await upsertTextFileInFolder(token, folderId, 'patient-summary.md', markdown, 'text/plain');

  console.log(
    JSON.stringify(
      { id: folderId, name: PATIENT.name, dob: PATIENT.dob, sex: PATIENT.sex },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
