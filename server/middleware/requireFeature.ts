import { Request, Response, NextFunction } from 'express';
import { DEFAULT_USER_SETTINGS, normalizeUserSettings, type UserSettings } from '../../shared/types';
import { resolveEffectiveFeatureFlags, type EffectiveFeatureFlags } from '../../shared/featureFlags';
import { getVpsJwt, getVpsConfig } from '../services/vpsApi';
import { loadExtensionRegistry } from '../services/extensionsRegistry';

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

async function loadUserSettingsForEmail(vpsJwt: string, userEmail: string): Promise<UserSettings> {
  const raw = await getVpsConfig(vpsJwt, USER_SETTINGS_KEY);
  const parsed = parseSettingsBlob(raw);
  const emailKey = normalizeSettingsEmail(userEmail);

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

  // Backward compatibility with plain legacy settings object.
  return normalizeUserSettings(parsed);
}

export function requireFeature(feature: keyof EffectiveFeatureFlags) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.session.accessToken;
      const userEmail = req.session.userEmail;

      if (!token || !userEmail) {
        res.status(401).json({ error: 'Not authenticated. Please sign in.' });
        return;
      }

      const vpsJwt = await getVpsJwt(token, userEmail);
      const settings = await loadUserSettingsForEmail(vpsJwt, userEmail);
      const registry = loadExtensionRegistry();
      const effective = resolveEffectiveFeatureFlags(settings, registry);

      if (!effective[feature]) {
        res.status(403).json({ error: `Feature disabled: ${feature}` });
        return;
      }

      next();
    } catch (err) {
      console.error(`Feature gate error (${feature}):`, err);
      res.status(500).json({ error: 'Failed to evaluate feature access.' });
    }
  };
}
