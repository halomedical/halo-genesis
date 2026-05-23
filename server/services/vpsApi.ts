import { Request } from 'express';
import { config } from '../config';
import { driveRequest, getHaloRootFolder } from './drive';

const VPS_CREDS_FILE = 'halo_vps_creds.json';

interface VpsTokenResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  email: string;
  name: string;
}

export interface VpsCreds {
  email: string;
  password: string;
  jwt: string;
  jwtExpiresAt: string;
}

// --- Low-level VPS HTTP helpers ---

async function vpsPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${config.vpsBaseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`VPS ${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function vpsGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${config.vpsBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`VPS ${path} ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

// --- Drive-backed VPS creds store ---

async function findInRoot(driveToken: string, rootId: string, name: string): Promise<string | null> {
  const q = encodeURIComponent(`'${rootId}' in parents and name='${name}' and trashed=false`);
  const data = await driveRequest(driveToken, `/files?q=${q}&fields=files(id)`) as { files?: Array<{ id: string }> };
  return data.files?.[0]?.id ?? null;
}

async function readDrive(driveToken: string, fileId: string): Promise<string> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${driveToken}` },
  });
  if (!res.ok) throw new Error(`Drive read ${res.status}`);
  return res.text();
}

async function writeDrive(driveToken: string, rootId: string, existingId: string | null, name: string, content: string): Promise<void> {
  const body = Buffer.from(content, 'utf8');
  if (existingId) {
    await fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': 'application/json' },
      body,
    });
    return;
  }
  const boundary = 'halo_vps_b';
  const meta = JSON.stringify({ name, parents: [rootId], mimeType: 'application/json' });
  const mp = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n` +
    `--${boundary}--`
  );
  await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${driveToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: mp,
  });
}

export async function loadVpsCreds(driveToken: string): Promise<VpsCreds | null> {
  try {
    const rootId = await getHaloRootFolder(driveToken);
    const fileId = await findInRoot(driveToken, rootId, VPS_CREDS_FILE);
    if (!fileId) return null;
    return JSON.parse(await readDrive(driveToken, fileId)) as VpsCreds;
  } catch { return null; }
}

async function saveVpsCreds(driveToken: string, creds: VpsCreds): Promise<void> {
  const rootId = await getHaloRootFolder(driveToken);
  const existingId = await findInRoot(driveToken, rootId, VPS_CREDS_FILE);
  await writeDrive(driveToken, rootId, existingId, VPS_CREDS_FILE, JSON.stringify(creds));
}

// Returns a valid VPS JWT for the user.
// Uses POST /auth/google — the VPS verifies the Google token and returns the
// correct JWT for that user, creating the account if it doesn't exist yet.
// The JWT is cached in Drive for 23 hours to avoid calling Google on every request.
export async function getVpsJwt(
  driveToken: string,
  userEmail: string,
  refreshToken?: string,
): Promise<string> {
  // Return cached JWT if it has at least 60 seconds of life left
  const existing = await loadVpsCreds(driveToken);
  if (existing && new Date(existing.jwtExpiresAt).getTime() > Date.now() + 60_000) {
    return existing.jwt;
  }

  // Authenticate via the VPS Google endpoint — always returns the correct user's JWT
  const storedRefresh = existing?.password ?? '';
  const data = await vpsPost<VpsTokenResponse>('/auth/google', {
    google_access_token: driveToken,
    google_refresh_token: refreshToken ?? storedRefresh,
    email: userEmail,
    name: userEmail.split('@')[0],
  });

  const creds: VpsCreds = {
    email: userEmail,
    password: refreshToken ?? storedRefresh,  // reuse password field to persist refresh token
    jwt: data.access_token,
    jwtExpiresAt: new Date(Date.now() + 23 * 3600 * 1000).toISOString(),
  };
  await saveVpsCreds(driveToken, creds).catch(() => {});
  return data.access_token;
}

// Resolves the VPS JWT for the current request.
// Prefers the session-level JWT (set at OAuth time) over the Drive-cached one,
// ensuring every VPS call operates on the correct user's data.
export async function resolveVpsJwt(req: Request): Promise<string> {
  if (req.session.vpsJwt) return req.session.vpsJwt;
  return getVpsJwt(req.session.accessToken!, req.session.userEmail!, req.session.refreshToken);
}

// --- Generic config helpers ---

export async function getVpsConfig(vpsJwt: string, key: string): Promise<string | null> {
  try {
    const data = await vpsGet<{ value: string }>(`/doctor/config/${key}`, vpsJwt);
    return data.value;
  } catch { return null; }
}

export async function setVpsConfig(vpsJwt: string, key: string, value: string): Promise<void> {
  await vpsPost('/doctor/config', { key, value }, vpsJwt);
}

// --- Billing cap ---

export async function getBillingCap(vpsJwt: string): Promise<number | null> {
  try {
    const data = await vpsGet<{ value: string }>('/doctor/config/admin_agent_billing_cap', vpsJwt);
    const n = parseInt(data.value, 10);
    return isNaN(n) ? null : n;
  } catch { return null; }
}

export async function setBillingCap(vpsJwt: string, capRands: number): Promise<void> {
  await vpsPost('/doctor/config', { key: 'admin_agent_billing_cap', value: String(capRands) }, vpsJwt);
}

export async function markSetupDone(vpsJwt: string): Promise<void> {
  await vpsPost('/doctor/config', { key: 'admin_agent_setup_done', value: 'true' }, vpsJwt);
}

// --- Token tier ---

export async function getTier(vpsJwt: string): Promise<number> {
  try {
    const data = await vpsGet<{ value: string }>('/doctor/config/admin_agent_tier', vpsJwt);
    const n = parseInt(data.value, 10);
    return [1, 2, 3].includes(n) ? n : 1;
  } catch { return 1; }
}

export async function setTier(vpsJwt: string, tierId: number): Promise<void> {
  await vpsPost('/doctor/config', { key: 'admin_agent_tier', value: String(tierId) }, vpsJwt);
}

// --- Token usage ---

export interface TokenUsage {
  tokens_used: number;
  tokens_limit: number;
  reset_date: string;
}

export async function getTokenUsage(vpsJwt: string, tierId: number): Promise<TokenUsage> {
  const TIER_LIMITS: Record<number, number> = { 1: 500_000, 2: 2_000_000, 3: 5_000_000 };
  let tokensUsed = 0;
  let resetDate = '';

  try {
    const usageData = await vpsGet<{ value: string }>('/doctor/config/admin_agent_tokens_used', vpsJwt);
    tokensUsed = parseInt(usageData.value, 10) || 0;
  } catch { /* default 0 */ }

  try {
    const resetData = await vpsGet<{ value: string }>('/doctor/config/admin_agent_token_reset_date', vpsJwt);
    resetDate = resetData.value;
  } catch { /* default empty */ }

  // Reset counter if we're past the reset date
  if (resetDate) {
    const now = new Date();
    const reset = new Date(resetDate);
    if (now >= reset) {
      tokensUsed = 0;
      const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      vpsPost('/doctor/config', { key: 'admin_agent_tokens_used', value: '0' }, vpsJwt).catch(() => {});
      vpsPost('/doctor/config', { key: 'admin_agent_token_reset_date', value: nextReset.toISOString().split('T')[0] }, vpsJwt).catch(() => {});
      resetDate = nextReset.toISOString().split('T')[0];
    }
  } else {
    // First time — set reset date to first of next month
    const now = new Date();
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    resetDate = nextReset.toISOString().split('T')[0];
    vpsPost('/doctor/config', { key: 'admin_agent_token_reset_date', value: resetDate }, vpsJwt).catch(() => {});
  }

  return {
    tokens_used: tokensUsed,
    tokens_limit: TIER_LIMITS[tierId] ?? 500_000,
    reset_date: resetDate,
  };
}

export async function incrementTokenUsage(vpsJwt: string, tokensToAdd: number): Promise<void> {
  try {
    let current = 0;
    try {
      const data = await vpsGet<{ value: string }>('/doctor/config/admin_agent_tokens_used', vpsJwt);
      current = parseInt(data.value, 10) || 0;
    } catch { /* start from 0 */ }
    await vpsPost('/doctor/config', { key: 'admin_agent_tokens_used', value: String(current + tokensToAdd) }, vpsJwt);
  } catch { /* non-fatal */ }
}

// --- Automations ---

import type { Automation } from '../agent/capabilities';

export async function getAutomations(vpsJwt: string): Promise<Automation[]> {
  try {
    const data = await vpsGet<{ value: string }>('/doctor/config/admin_agent_automations', vpsJwt);
    return JSON.parse(data.value) as Automation[];
  } catch { return []; }
}

export async function saveAutomations(vpsJwt: string, automations: Automation[]): Promise<void> {
  await vpsPost('/doctor/config', { key: 'admin_agent_automations', value: JSON.stringify(automations) }, vpsJwt);
}

// --- Task log ---

export interface TaskLogEntry {
  automationId: string;
  automationName: string;
  ranAt: string;
  result: 'success' | 'partial' | 'failed';
  note?: string;
}

export async function appendTaskLog(vpsJwt: string, entry: TaskLogEntry): Promise<void> {
  try {
    let log: TaskLogEntry[] = [];
    try {
      const data = await vpsGet<{ value: string }>('/doctor/config/admin_agent_task_log', vpsJwt);
      log = JSON.parse(data.value) as TaskLogEntry[];
    } catch { /* start fresh */ }
    log.push(entry);
    // Keep last 100 entries
    if (log.length > 100) log = log.slice(-100);
    await vpsPost('/doctor/config', { key: 'admin_agent_task_log', value: JSON.stringify(log) }, vpsJwt);
  } catch { /* non-fatal */ }
}

// --- OneDrive ---

export function getOnedriveAuthUrl(vpsJwt: string): string {
  return `${config.vpsBaseUrl}/onedrive/auth?token=${vpsJwt}`;
}

export async function getOnedriveStatus(vpsJwt: string): Promise<{ connected: boolean }> {
  try {
    return await vpsGet<{ connected: boolean }>('/onedrive/status', vpsJwt);
  } catch { return { connected: false }; }
}

export async function triggerOnedriveSetup(vpsJwt: string): Promise<void> {
  try {
    await vpsPost('/onedrive/setup', {}, vpsJwt);
  } catch { /* non-fatal if setup fails */ }
}
