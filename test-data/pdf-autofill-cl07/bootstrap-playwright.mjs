import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.join(__dirname, '.auth-profile');
const summaryPath = path.join(
  __dirname,
  'Margaret_Ndlovu__1987-03-14__F',
  'patient-summary.md'
);
const markdown = fs.readFileSync(summaryPath, 'utf8');
const API_BASE = 'http://localhost:3001';

const PATIENT = {
  name: 'Margaret Thandi Ndlovu',
  dob: '1987-03-14',
  sex: 'F',
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

async function apiJson(request, method, urlPath, body) {
  const res = await request.fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    data: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok()) {
    throw new Error(
      `${urlPath} → ${res.status()}: ${typeof data === 'object' ? JSON.stringify(data) : data}`
    );
  }
  return data;
}

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 1280, height: 900 },
});

const page = context.pages()[0] ?? (await context.newPage());
const request = context.request;

let me = await apiJson(request, 'GET', '/api/auth/me').catch(() => ({ signedIn: false }));

if (!me.signedIn) {
  console.log('Opening Google sign-in for Halo (complete login in the browser window)…');
  const loginMeta = await apiJson(request, 'GET', '/api/auth/login-url');
  await page.goto(loginMeta.url, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/localhost:5173/, { timeout: 180_000 });
  await page.waitForTimeout(1500);
  me = await apiJson(request, 'GET', '/api/auth/me');
}

if (!me.signedIn) {
  await context.close();
  throw new Error('Not signed in after OAuth. Try again or sign in at http://localhost:5173 first.');
}

console.log('Signed in as', me.email || '(unknown email)');

await apiJson(request, 'GET', '/api/drive/patients');

console.log('Creating patient folder in Drive…');
const patient = await apiJson(request, 'POST', '/api/drive/patients', PATIENT);
const folderId = patient.id;

const list = await apiJson(request, 'GET', `/api/drive/patients/${folderId}/files?pageSize=100`);
const stubSummary = (list.files || []).find((f) => f.name === '_Summary.md');
if (stubSummary) {
  console.log('Removing stub _Summary.md…');
  await apiJson(request, 'DELETE', `/api/drive/files/${stubSummary.id}`);
}

const fileData = Buffer.from(markdown, 'utf8').toString('base64');
console.log('Uploading patient-summary.md…');
await apiJson(request, 'POST', `/api/drive/patients/${folderId}/upload`, {
  fileName: 'patient-summary.md',
  fileType: 'text/plain',
  fileData,
  patientId: folderId,
});

console.log('Created test patient:', { id: folderId, name: patient.name, dob: patient.dob });
await context.close();
