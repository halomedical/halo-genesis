import {
  DEFAULT_USER_MODULES,
  DEFAULT_USER_SETTINGS,
  normalizeUserSettings,
  type UserModulesSettings,
  type UserSettings,
} from '../../shared/types';
import { resolveEffectiveFeatureFlags, type EffectiveFeatureFlags } from '../../shared/featureFlags';
import { config } from '../config';
import { getVpsConfig, setVpsConfig } from './vpsApi';
import { loadExtensionRegistry } from './extensionsRegistry';

export const USER_SETTINGS_KEY = 'user_settings';
const USER_SETTINGS_V2_MARKER = '__by_email__';

export type FeatureGrantsMap = Record<string, Partial<UserModulesSettings>>;

function normalizeEmail(userEmail: string): string {
  return String(userEmail || '').trim().toLowerCase();
}

function parseGrantsEnv(): FeatureGrantsMap {
  const raw = process.env.USER_FEATURE_GRANTS_JSON;
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as FeatureGrantsMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.warn('[userFeatures] Invalid USER_FEATURE_GRANTS_JSON — ignoring');
    return {};
  }
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

export function extractUserSettingsFromBlob(
  parsed: Record<string, unknown> | null,
  userEmail: string
): UserSettings {
  const emailKey = normalizeEmail(userEmail);
  if (!parsed) return DEFAULT_USER_SETTINGS;

  const byEmail = parsed[USER_SETTINGS_V2_MARKER];
  if (byEmail && typeof byEmail === 'object') {
    const scoped = (byEmail as Record<string, unknown>)[emailKey];
    const legacy = (byEmail as Record<string, unknown>).__legacy__;
    return normalizeUserSettings(
      (scoped && typeof scoped === 'object')
        ? (scoped as Record<string, unknown>)
        : ((legacy && typeof legacy === 'object') ? (legacy as Record<string, unknown>) : undefined)
    );
  }

  return normalizeUserSettings(parsed);
}

export async function loadUserSettingsForEmail(vpsJwt: string, userEmail: string): Promise<UserSettings> {
  const raw = await getVpsConfig(vpsJwt, USER_SETTINGS_KEY);
  const parsed = parseSettingsBlob(raw);
  return extractUserSettingsFromBlob(parsed, userEmail);
}

export function resolveStoredModules(settings: UserSettings): UserModulesSettings {
  return {
    ...DEFAULT_USER_MODULES,
    ...(settings.modules || {}),
  };
}

/** Server-side module grants: stored VPS settings, then env overrides (per email, then default). */
export function resolveAuthoritativeModules(
  userEmail: string,
  storedSettings: UserSettings
): UserModulesSettings {
  const grants = parseGrantsEnv();
  const stored = resolveStoredModules(storedSettings);
  const defaultGrant = grants.default || grants['*'] || {};
  const emailGrant = grants[normalizeEmail(userEmail)] || {};
  return {
    ...stored,
    ...defaultGrant,
    ...emailGrant,
  };
}

export function resolveEffectiveFeaturesForUser(
  userEmail: string,
  storedSettings: UserSettings
): EffectiveFeatureFlags {
  const settingsWithModules: UserSettings = {
    ...storedSettings,
    modules: resolveAuthoritativeModules(userEmail, storedSettings),
  };
  const registry = loadExtensionRegistry();
  return resolveEffectiveFeatureFlags(settingsWithModules, registry);
}

/** Drop client-supplied module toggles; modules are managed server-side only. */
export function mergeSettingsPreservingServerModules(
  incoming: UserSettings,
  existing: UserSettings
): UserSettings {
  const normalized = normalizeUserSettings(incoming);
  return normalizeUserSettings({
    ...normalized,
    modules: resolveStoredModules(existing),
  });
}

export function isFeatureAdmin(email: string | undefined): boolean {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  return config.featureAdminEmails.includes(normalized);
}

async function loadSettingsBlob(vpsJwt: string): Promise<Record<string, unknown>> {
  const raw = await getVpsConfig(vpsJwt, USER_SETTINGS_KEY);
  const parsed = parseSettingsBlob(raw);
  if (parsed && parsed[USER_SETTINGS_V2_MARKER] && typeof parsed[USER_SETTINGS_V2_MARKER] === 'object') {
    return parsed;
  }
  const nextBlob: Record<string, unknown> = { [USER_SETTINGS_V2_MARKER]: {} };
  if (parsed) {
    (nextBlob[USER_SETTINGS_V2_MARKER] as Record<string, unknown>).__legacy__ = parsed;
  }
  return nextBlob;
}

export async function saveUserSettingsForEmail(
  vpsJwt: string,
  userEmail: string,
  settings: UserSettings
): Promise<void> {
  const emailKey = normalizeEmail(userEmail);
  const blob = await loadSettingsBlob(vpsJwt);
  const byEmail = blob[USER_SETTINGS_V2_MARKER] as Record<string, unknown>;
  byEmail[emailKey] = normalizeUserSettings(settings);
  try {
    await setVpsConfig(vpsJwt, USER_SETTINGS_KEY, JSON.stringify(blob));
  } catch (err) {
    console.error('[userFeatures] setVpsConfig failed:', err);
    throw new Error('Could not save settings to the platform. Please try again or contact support.');
  }
}

/** Admin-only: persist module grants for a user in VPS settings. */
export async function setUserModulesForEmail(
  vpsJwt: string,
  targetEmail: string,
  modules: Partial<UserModulesSettings>
): Promise<UserModulesSettings> {
  const existing = await loadUserSettingsForEmail(vpsJwt, targetEmail);
  const nextModules: UserModulesSettings = {
    ...resolveStoredModules(existing),
    ...modules,
  };
  await saveUserSettingsForEmail(vpsJwt, targetEmail, {
    ...existing,
    modules: nextModules,
  });
  return nextModules;
}
