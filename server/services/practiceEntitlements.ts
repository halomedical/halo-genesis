import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config';
import { loadExtensionRegistry } from './extensionsRegistry';
import { resolveEffectiveFeatureFlags, type EffectiveFeatureFlags } from '../../shared/featureFlags';
import { practiceModuleRowsToSettings } from '../../shared/practiceModules';
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

export interface PracticeUser {
  email: string;
  practiceId: string;
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

  supabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
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

  const { data: featureRows, error: featuresError } = await supabase
    .from('practice_features')
    .select('module, enabled')
    .eq('practice_id', membership.practice_id);

  if (featuresError) {
    console.error('[practiceEntitlements] practice_features lookup failed:', featuresError.message);
    throw new Error('Failed to load practice entitlements.');
  }

  const modules = practiceModuleRowsToSettings(featureRows || []);
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

async function getMembershipByEmail(email: string): Promise<{ practice_id: string } | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: membership, error } = await supabase
    .from('practice_users')
    .select('practice_id')
    .eq('email', normalizeEmail(email))
    .maybeSingle();

  if (error) {
    console.error('[practiceEntitlements] membership lookup failed:', error.message);
    throw new Error('Failed to load practice membership.');
  }
  if (!membership?.practice_id) return null;
  return { practice_id: membership.practice_id };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'practice';
}

async function bootstrapPracticeForEmail(email: string): Promise<{ practice_id: string }> {
  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Practice users are not configured.');
  }

  const localPart = email.split('@')[0] || 'practice';
  const practiceName = `${localPart.replace(/[._-]+/g, ' ')} Practice`
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const slug = `${slugify(localPart)}-${Math.random().toString(36).slice(2, 8)}`;

  const { data: createdPractice, error: createPracticeError } = await supabase
    .from('practices')
    .insert({
      name: practiceName,
      slug,
      onboarding_completed_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (createPracticeError || !createdPractice?.id) {
    console.error('[practiceEntitlements] bootstrap practice create failed:', createPracticeError?.message);
    throw new Error('Failed to create a practice workspace.');
  }

  const practiceId = createdPractice.id as string;

  const { error: addSelfError } = await supabase
    .from('practice_users')
    .insert({
      practice_id: practiceId,
      email,
      role: 'owner',
    });
  if (addSelfError) {
    console.error('[practiceEntitlements] bootstrap self membership failed:', addSelfError.message);
    throw new Error('Failed to initialize your practice membership.');
  }

  const defaultModules: Array<{ module: string; enabled: boolean }> = [
    { module: 'admissions', enabled: Boolean(DEFAULT_USER_MODULES.admissions) },
    { module: 'admin_agent', enabled: Boolean(DEFAULT_USER_MODULES.adminAgent) },
    { module: 'scribe', enabled: Boolean(DEFAULT_USER_MODULES.scribe) },
    { module: 'billing', enabled: Boolean(DEFAULT_USER_MODULES.billing) },
  ];

  const { error: featuresError } = await supabase
    .from('practice_features')
    .insert(defaultModules.map((item) => ({
      practice_id: practiceId,
      module: item.module,
      enabled: item.enabled,
    })));
  if (featuresError) {
    console.error('[practiceEntitlements] bootstrap feature seed failed:', featuresError.message);
    // Non-fatal; user membership is already created.
  }

  return { practice_id: practiceId };
}

async function getOrBootstrapMembershipByEmail(
  email: string,
  opts?: { allowBootstrap?: boolean }
): Promise<{ practice_id: string } | null> {
  const existing = await getMembershipByEmail(email);
  if (existing?.practice_id) return existing;
  if (!opts?.allowBootstrap) return null;
  return bootstrapPracticeForEmail(email);
}

export async function getPracticeUsersForEmail(userEmail: string): Promise<PracticeUser[]> {
  const email = normalizeEmail(userEmail);
  if (!email) return [];

  const supabase = getSupabase();
  if (!supabase) return [];

  const membership = await getOrBootstrapMembershipByEmail(email, { allowBootstrap: true });
  if (!membership?.practice_id) return [];

  const { data, error } = await supabase
    .from('practice_users')
    .select('email, practice_id')
    .eq('practice_id', membership.practice_id)
    .order('email', { ascending: true });

  if (error) {
    console.error('[practiceEntitlements] practice users lookup failed:', error.message);
    throw new Error('Failed to load practice users.');
  }

  return (data || [])
    .filter((row) => typeof row.email === 'string' && typeof row.practice_id === 'string')
    .map((row) => ({
      email: row.email,
      practiceId: row.practice_id,
    }));
}

export async function addPracticeUserForEmail(
  requesterEmail: string,
  targetEmail: string
): Promise<PracticeUser[]> {
  const requester = normalizeEmail(requesterEmail);
  const target = normalizeEmail(targetEmail);
  if (!requester || !target) {
    throw new Error('A valid email is required.');
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Practice users are not configured.');
  }

  const membership = await getOrBootstrapMembershipByEmail(requester, { allowBootstrap: true });
  if (!membership?.practice_id) {
    throw new Error('You are not assigned to a practice.');
  }

  const { data: existing, error: existingError } = await supabase
    .from('practice_users')
    .select('email')
    .eq('email', target)
    .maybeSingle();
  if (existingError) {
    console.error('[practiceEntitlements] target lookup failed:', existingError.message);
    throw new Error('Failed to check existing practice user.');
  }

  if (!existing?.email) {
    const { error: insertError } = await supabase
      .from('practice_users')
      .insert({
        email: target,
        practice_id: membership.practice_id,
      });
    if (insertError) {
      console.error('[practiceEntitlements] add user failed:', insertError.message);
      throw new Error('Failed to add practice user.');
    }
  }

  return getPracticeUsersForEmail(requester);
}

export async function removePracticeUserForEmail(
  requesterEmail: string,
  targetEmail: string
): Promise<PracticeUser[]> {
  const requester = normalizeEmail(requesterEmail);
  const target = normalizeEmail(targetEmail);
  if (!requester || !target) {
    throw new Error('A valid email is required.');
  }
  if (requester === target) {
    throw new Error('You cannot remove your own account from the practice.');
  }

  const supabase = getSupabase();
  if (!supabase) {
    throw new Error('Practice users are not configured.');
  }

  const membership = await getMembershipByEmail(requester);
  if (!membership?.practice_id) {
    throw new Error('You are not assigned to a practice.');
  }

  const { error: removeError } = await supabase
    .from('practice_users')
    .delete()
    .eq('practice_id', membership.practice_id)
    .eq('email', target);
  if (removeError) {
    console.error('[practiceEntitlements] remove user failed:', removeError.message);
    throw new Error('Failed to remove practice user.');
  }

  return getPracticeUsersForEmail(requester);
}
