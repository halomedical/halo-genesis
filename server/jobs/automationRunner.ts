/**
 * Halo Automation Runner
 * Evaluates and executes doctor-defined automations on a 30-minute schedule.
 *
 * Doctors are registered when they authenticate; their Google refresh token
 * is stored so the runner can obtain a fresh Drive token independently of
 * their HTTP session.
 */

import { config } from '../config';
import { getVpsJwt } from '../services/vpsApi';
import { getAutomations, appendTaskLog, saveAutomations } from '../services/vpsApi';
import type { Automation } from '../agent/capabilities';

const RUNNER_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

interface DoctorSession {
  email: string;
  driveRefreshToken: string;
  registeredAt: number;
}

// In-memory store: email → session. Populated from authenticated requests.
const sessions = new Map<string, DoctorSession>();

/**
 * Called from authenticated request handlers so the runner knows which
 * doctors to process. The refresh token lets us obtain fresh Drive tokens.
 */
export function registerSession(email: string, driveRefreshToken: string): void {
  if (!email || !driveRefreshToken) return;
  sessions.set(email, { email, driveRefreshToken, registeredAt: Date.now() });
}

async function refreshDriveToken(refreshToken: string): Promise<string> {
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
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new Error(`No access_token in response: ${data.error}`);
  return data.access_token;
}

function shouldRunNow(automation: Automation): boolean {
  const { trigger, frequency, lastRunAt } = automation;

  if (trigger === 'event' || trigger === 'calendar') return false; // event-driven, not polling

  if (!lastRunAt) return true; // never run

  const last = new Date(lastRunAt).getTime();
  const now = Date.now();
  const elapsed = now - last;

  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  switch (frequency) {
    case 'hourly': return elapsed >= HOUR;
    case '5x/day': return elapsed >= DAY / 5;
    case '3x/day': return elapsed >= DAY / 3;
    case '2x/day': return elapsed >= DAY / 2;
    case 'daily': return elapsed >= DAY;
    default: return elapsed >= DAY;
  }
}

async function executeAutomation(
  automation: Automation,
  driveToken: string,
  vpsJwt: string,
  email: string
): Promise<{ result: 'success' | 'partial' | 'failed'; note: string }> {
  // Execution stubs — the full execution chain will be built out as each
  // capability endpoint matures. For now we log what would run.

  console.log(`[AutomationRunner] Executing: ${automation.name} (${automation.id}) for ${email}`);

  // Stub implementations per preset type
  switch (automation.id) {
    case 'email_monitor':
      // Would: scan Gmail inbox, classify emails, draft letters, save to Review
      return { result: 'partial', note: 'Email monitor ran — full execution pending Gmail capability.' };

    case 'morning_brief':
      // Would: generate summary of overnight completions — already handled by morning-brief endpoint
      return { result: 'success', note: 'Morning brief generated.' };

    case 'referral_feedback':
      // Event-driven — shouldn't reach here via scheduler
      return { result: 'partial', note: 'Referral feedback is event-driven — waiting for trigger.' };

    case 'pre_consult_summary':
      // Would: read calendar, find appointments in next 30 min, generate summaries
      return { result: 'partial', note: 'Pre-consult summary requires calendar integration.' };

    default:
      // Custom automation — describe what would happen
      return {
        result: 'partial',
        note: `Custom automation "${automation.name}" queued — manual execution required.`,
      };
  }
}

async function runForDoctor(session: DoctorSession): Promise<void> {
  let driveToken: string;
  try {
    driveToken = await refreshDriveToken(session.driveRefreshToken);
  } catch (err) {
    console.error(`[AutomationRunner] Could not refresh token for ${session.email}:`, err);
    return;
  }

  let vpsJwt: string;
  try {
    vpsJwt = await getVpsJwt(driveToken, session.email);
  } catch (err) {
    console.error(`[AutomationRunner] Could not get VPS JWT for ${session.email}:`, err);
    return;
  }

  let automations: Automation[];
  try {
    automations = await getAutomations(vpsJwt);
  } catch (err) {
    console.error(`[AutomationRunner] Could not load automations for ${session.email}:`, err);
    return;
  }

  const toRun = automations.filter(a => a.enabled && shouldRunNow(a));
  if (toRun.length === 0) return;

  console.log(`[AutomationRunner] Running ${toRun.length} automation(s) for ${session.email}`);

  const updatedAutomations = [...automations];

  for (const automation of toRun) {
    try {
      const { result, note } = await executeAutomation(automation, driveToken, vpsJwt, session.email);

      await appendTaskLog(vpsJwt, {
        automationId: automation.id,
        automationName: automation.name,
        ranAt: new Date().toISOString(),
        result,
        note,
      });

      // Update lastRunAt
      const idx = updatedAutomations.findIndex(a => a.id === automation.id);
      if (idx !== -1) {
        updatedAutomations[idx] = { ...updatedAutomations[idx], lastRunAt: new Date().toISOString() };
      }
    } catch (err) {
      console.error(`[AutomationRunner] Error executing ${automation.id} for ${session.email}:`, err);
    }
  }

  try {
    await saveAutomations(vpsJwt, updatedAutomations);
  } catch (err) {
    console.error(`[AutomationRunner] Failed to save updated automations for ${session.email}:`, err);
  }
}

async function runAll(): Promise<void> {
  if (sessions.size === 0) return;

  const now = Date.now();
  const STALE_MS = 48 * 60 * 60 * 1000; // Remove sessions older than 48h

  for (const [email, session] of sessions.entries()) {
    if (now - session.registeredAt > STALE_MS) {
      sessions.delete(email);
      continue;
    }
    try {
      await runForDoctor(session);
    } catch (err) {
      console.error(`[AutomationRunner] Unhandled error for ${email}:`, err);
    }
  }
}

async function seedSessionsFromVps(): Promise<void> {
  if (!config.vpsAdminEmail || !config.vpsAdminPassword) return;
  try {
    const loginRes = await fetch(`${config.vpsBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: config.vpsAdminEmail, password: config.vpsAdminPassword }),
    });
    if (!loginRes.ok) throw new Error(`VPS admin login ${loginRes.status}`);
    const { access_token: adminJwt } = (await loginRes.json()) as { access_token: string };

    const sessionsRes = await fetch(`${config.vpsBaseUrl}/agent/sessions`, {
      headers: { Authorization: `Bearer ${adminJwt}` },
    });
    if (!sessionsRes.ok) throw new Error(`VPS sessions ${sessionsRes.status}`);
    const { sessions: vpsSessions } = (await sessionsRes.json()) as {
      sessions: Array<{ email: string; refreshToken?: string; lastSeen?: string }>;
    };

    let count = 0;
    for (const s of vpsSessions) {
      if (s.email && s.refreshToken) {
        registerSession(s.email, s.refreshToken);
        count++;
      }
    }
    console.log(`[AutomationRunner] Seeded ${count} session(s) from VPS`);
  } catch (err) {
    console.warn('[AutomationRunner] seedSessionsFromVps failed (non-fatal):', err);
  }
}

let runnerInterval: ReturnType<typeof setInterval> | null = null;

export function startAutomationRunner(): void {
  if (runnerInterval) return;
  console.log('[AutomationRunner] Started — checking every 30 minutes');
  // Seed sessions from VPS on startup so automations survive Heroku restarts
  seedSessionsFromVps().catch(() => {});
  runnerInterval = setInterval(() => {
    runAll().catch(err => console.error('[AutomationRunner] Run error:', err));
  }, RUNNER_INTERVAL_MS);
}

export function stopAutomationRunner(): void {
  if (runnerInterval) {
    clearInterval(runnerInterval);
    runnerInterval = null;
    console.log('[AutomationRunner] Stopped');
  }
}
