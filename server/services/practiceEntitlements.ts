import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from '../config';
import { loadExtensionRegistry } from './extensionsRegistry';
import { resolveEffectiveFeatureFlags, type EffectiveFeatureFlags } from '../../shared/featureFlags';
import { practiceFeatureRowToSettings } from '../../shared/practiceModules';
import { DEFAULT_USER_MODULES, normalizeUserSettings, type UserModulesSettings } from '../../shared/types';

export interface PracticeSummary {
  id: string;
  name: string;
  slug: string;
}

export interface PracticeEntitlementsResult {
  effective: EffectiveFeatureFlags;
  modules: UserModulesSettings;
  practice: PracticeSummary | null;
  source: 'database' | 'default';
}

let supabaseClient: SupabaseClient | null | undefined;

function getSupabase(): SupabaseClient | null {
  if (supabaseClient !== undefined) {
    return supabaseClient;
  }

  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    supabaseClient = null;
    return null;
  }

  // Node 20 (Heroku) has no native WebSocket; @supabase/realtime-js requires `ws`.
  supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: ws as never },
  });
  return supabaseClient;
}

function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function defaultEntitlements(): PracticeEntitlementsResult {
  const modules = { ...DEFAULT_USER_MODULES };
  const registry = loadExtensionRegistry();
  return {
    effective: resolveEffectiveFeatureFlags(normalizeUserSettings({ modules }), registry),
    modules,
    practice: null,
    source: 'default',
  };
}

export function isPracticeEntitlementsConfigured(): boolean {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

/**
 * Resolve module access for a signed-in user from Supabase practice_features.
 * Falls back to DEFAULT_USER_MODULES when Supabase is off or the email is not mapped.
 */
export async function getPracticeEntitlementsForEmail(
  userEmail: string
): Promise<PracticeEntitlementsResult> {
  const email = normalizeEmail(userEmail);
  if (!email) {
    return defaultEntitlements();
  }

  const supabase = getSupabase();
  if (!supabase) {
    return defaultEntitlements();
  }

  const { data: membership, error: membershipError } = await supabase
    .from('practice_users')
    .select('practice_id, practices ( id, name, slug )')
    .eq('email', email)
    .maybeSingle();

  if (membershipError) {
    console.error('[practiceEntitlements] practice_users lookup failed:', membershipError.message);
    throw new Error('Failed to load practice entitlements.');
  }

  if (!membership?.practice_id) {
    console.warn(`[practiceEntitlements] No practice_users row for ${email}; using default modules.`);
    return defaultEntitlements();
  }

  const practiceRow = membership.practices as
    | { id: string; name: string; slug: string }
    | { id: string; name: string; slug: string }[]
    | null;

  const practiceRecord = Array.isArray(practiceRow) ? practiceRow[0] : practiceRow;

  const { data: featureRow, error: featuresError } = await supabase
    .from('practice_features')
    .select('admissions, admin_agent, scribe, billing')
    .eq('practice_id', membership.practice_id)
    .maybeSingle();

  if (featuresError) {
    console.error('[practiceEntitlements] practice_features lookup failed:', featuresError.message);
    throw new Error('Failed to load practice entitlements.');
  }

  const modules = practiceFeatureRowToSettings(featureRow);
  const registry = loadExtensionRegistry();
  const effective = resolveEffectiveFeatureFlags(
    normalizeUserSettings({ modules }),
    registry
  );

  return {
    effective,
    modules,
    practice: practiceRecord
      ? { id: practiceRecord.id, name: practiceRecord.name, slug: practiceRecord.slug }
      : { id: membership.practice_id, name: 'Practice', slug: membership.practice_id },
    source: 'database',
  };
}
