import { DEFAULT_USER_SETTINGS, normalizeUserSettings, type UserSettings } from '../../shared/types';
import { resolvePatientNaming, type PatientNamingConfig } from '../../shared/patientNaming';
import { getVpsJwt, getVpsConfig } from './vpsApi';

const USER_SETTINGS_KEY = 'user_settings';
const USER_SETTINGS_V2_MARKER = '__by_email__';

function normalizeSettingsEmail(userEmail: string): string {
  return String(userEmail || '').trim().toLowerCase();
}

function parseSettingsBlob(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export async function loadUserSettingsForEmail(
  vpsJwt: string,
  userEmail: string
): Promise<UserSettings> {
  const raw = await getVpsConfig(vpsJwt, USER_SETTINGS_KEY);
  const parsed = parseSettingsBlob(raw);
  const emailKey = normalizeSettingsEmail(userEmail);

  if (!parsed) return DEFAULT_USER_SETTINGS;

  const byEmail = parsed[USER_SETTINGS_V2_MARKER];
  if (byEmail && typeof byEmail === 'object') {
    const scoped = (byEmail as Record<string, unknown>)[emailKey];
    const legacy = (byEmail as Record<string, unknown>).__legacy__;
    return normalizeUserSettings(
      scoped && typeof scoped === 'object'
        ? (scoped as Record<string, unknown>)
        : legacy && typeof legacy === 'object'
          ? (legacy as Record<string, unknown>)
          : undefined
    );
  }

  return normalizeUserSettings(parsed);
}

/** Load the signed-in user's settings (defaults on any failure). */
export async function loadUserSettingsFromSession(
  accessToken: string,
  userEmail: string
): Promise<UserSettings> {
  try {
    const vpsJwt = await getVpsJwt(accessToken, userEmail);
    return await loadUserSettingsForEmail(vpsJwt, userEmail);
  } catch (err) {
    console.warn('Failed to load user settings; using defaults.', err);
    return DEFAULT_USER_SETTINGS;
  }
}

export function resolveNamingFromSettings(settings: UserSettings): PatientNamingConfig {
  return resolvePatientNaming({
    patientNamingId: settings.patientNamingId,
    patientNamingConfig: settings.patientNamingConfig,
  });
}

export {
  USER_SETTINGS_KEY,
  USER_SETTINGS_V2_MARKER,
  normalizeSettingsEmail,
  parseSettingsBlob,
};
