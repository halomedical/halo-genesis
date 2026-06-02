import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from '../config';
import { loadExtensionRegistry } from './extensionsRegistry';
import { resolveEffectiveFeatureFlags, type EffectiveFeatureFlags } from '../../shared/featureFlags';
import { practiceFeatureRowToSettings } from '../../shared/practiceModules';
import { DEFAULT_USER_MODULES, normalizeUserSettings, type UserModulesSettings } from '../../shared/types';
import type { OnboardingCatalog, OnboardingModuleKey, OnboardingProfile } from '../../shared/onboarding';

export interface PracticeSummary {
  id: string;
  name: string;
  slug: string;
}

export interface PracticeEntitlementsResult {
  effective: EffectiveFeatureFlags;
  selectedModules: UserModulesSettings;
  autoModules: UserModulesSettings;
  modules: UserModulesSettings;
  practice: PracticeSummary | null;
  onboardingRequired: boolean;
  profile: OnboardingProfile | null;
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
    selectedModules: { ...modules },
    autoModules: { ...DEFAULT_USER_MODULES },
    modules,
    practice: null,
    onboardingRequired: true,
    profile: null,
    source: 'default',
  };
}

function orModules(a: UserModulesSettings, b: UserModulesSettings): UserModulesSettings {
  return {
    admissions: Boolean(a.admissions || b.admissions),
    adminAgent: Boolean(a.adminAgent || b.adminAgent),
    scribe: Boolean(a.scribe || b.scribe),
    billing: Boolean(a.billing || b.billing),
  };
}

function andModules(a: UserModulesSettings, b: UserModulesSettings): UserModulesSettings {
  return {
    admissions: Boolean(a.admissions && b.admissions),
    adminAgent: Boolean(a.adminAgent && b.adminAgent),
    scribe: Boolean(a.scribe && b.scribe),
    billing: Boolean(a.billing && b.billing),
  };
}

function sanitizeRole(role: string | null | undefined): string {
  return String(role || '').trim().slice(0, 64);
}

function slugify(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function normalizeOnboardingSelection(payload: unknown): UserModulesSettings {
  if (!payload || typeof payload !== 'object') {
    return { ...DEFAULT_USER_MODULES };
  }
  const input = payload as Partial<Record<OnboardingModuleKey, unknown>>;
  return {
    admissions: Boolean(input.admissions),
    adminAgent: Boolean(input.adminAgent),
    scribe: Boolean(input.scribe),
    billing: Boolean(input.billing),
  };
}

export interface SubmitOnboardingInput {
  role: string;
  specialtyKey: string;
  subspecialtyKey?: string | null;
  selectedModules: unknown;
}

interface MembershipRow {
  practice_id: string;
  role: string | null;
  specialty_id: string | null;
  subspecialty_id: string | null;
  onboarding_completed_at: string | null;
  practices:
    | { id: string; name: string; slug: string }
    | { id: string; name: string; slug: string }[]
    | null;
}

interface EntityLookup {
  id: string;
  key: string;
  label: string;
}

function errorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const maybe = err as { message?: unknown };
  return typeof maybe.message === 'string' ? maybe.message : '';
}

function isMissingSchemaError(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  return (
    msg.includes('does not exist') ||
    msg.includes('column') ||
    msg.includes('relation') ||
    msg.includes('schema cache')
  );
}

async function resolveEntityByKey(
  supabase: SupabaseClient,
  table: 'specialties' | 'subspecialties',
  key: string
): Promise<EntityLookup | null> {
  const normalized = String(key || '').trim().toLowerCase();
  if (!normalized) return null;
  const { data, error } = await supabase
    .from(table)
    .select('id, key, label')
    .eq('key', normalized)
    .maybeSingle();
  if (error) {
    console.error(`[practiceEntitlements] ${table} lookup failed:`, error.message);
    throw new Error('Failed to load onboarding data.');
  }
  return (data as EntityLookup | null) || null;
}

async function ensurePracticeMembershipByEmail(
  supabase: SupabaseClient,
  email: string
): Promise<MembershipRow> {
  const normalizedEmail = normalizeEmail(email);

  const existing = await supabase
    .from('practice_users')
    .select('practice_id, role, specialty_id, subspecialty_id, onboarding_completed_at, practices ( id, name, slug )')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (existing.error && isMissingSchemaError(existing.error)) {
    // Backward compatibility while migrations are still rolling out.
    const legacy = await supabase
      .from('practice_users')
      .select('practice_id, role, practices ( id, name, slug )')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (!legacy.error && (legacy.data as { practice_id?: string } | null)?.practice_id) {
      return {
        ...(legacy.data as Record<string, unknown>),
        specialty_id: null,
        subspecialty_id: null,
        onboarding_completed_at: null,
      } as MembershipRow;
    }
  }
  if (existing.error) {
    console.error('[practiceEntitlements] practice_users lookup failed:', existing.error.message);
    throw new Error('Failed to load practice entitlements.');
  }
  if (existing.data?.practice_id) {
    return existing.data as MembershipRow;
  }

  const localPart = normalizedEmail.split('@')[0] || 'user';
  const baseSlug = `${slugify(localPart) || 'user'}-practice`;
  const slug = `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`;
  const practiceName = `${localPart} Practice`;

  const createdPractice = await supabase
    .from('practices')
    .insert({ name: practiceName, slug })
    .select('id, name, slug')
    .single();
  if (createdPractice.error || !createdPractice.data?.id) {
    console.error('[practiceEntitlements] auto-create practice failed:', createdPractice.error?.message);
    throw new Error('Failed to auto-provision user practice.');
  }

  const practiceId = createdPractice.data.id as string;
  const [userInsert, featuresInsert] = await Promise.all([
    supabase.from('practice_users').insert({
      practice_id: practiceId,
      email: normalizedEmail,
      role: 'clinician',
    }),
    supabase.from('practice_features').upsert(
      {
        practice_id: practiceId,
        admissions: DEFAULT_USER_MODULES.admissions,
        admin_agent: DEFAULT_USER_MODULES.adminAgent,
        scribe: DEFAULT_USER_MODULES.scribe,
        billing: DEFAULT_USER_MODULES.billing,
      },
      { onConflict: 'practice_id' }
    ),
  ]);

  if (userInsert.error || featuresInsert.error) {
    console.error(
      '[practiceEntitlements] auto-provision membership/features failed:',
      userInsert.error?.message || featuresInsert.error?.message
    );
    throw new Error('Failed to auto-provision user membership.');
  }

  const provisioned = await supabase
    .from('practice_users')
    .select('practice_id, role, specialty_id, subspecialty_id, onboarding_completed_at, practices ( id, name, slug )')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (provisioned.error && isMissingSchemaError(provisioned.error)) {
    const legacy = await supabase
      .from('practice_users')
      .select('practice_id, role, practices ( id, name, slug )')
      .eq('email', normalizedEmail)
      .maybeSingle();
    if (!legacy.error && (legacy.data as { practice_id?: string } | null)?.practice_id) {
      return {
        ...(legacy.data as Record<string, unknown>),
        specialty_id: null,
        subspecialty_id: null,
        onboarding_completed_at: null,
      } as MembershipRow;
    }
  }
  if (provisioned.error || !provisioned.data?.practice_id) {
    console.error('[practiceEntitlements] reload auto-provisioned membership failed:', provisioned.error?.message);
    throw new Error('Failed to load auto-provisioned membership.');
  }
  return provisioned.data as MembershipRow;
}

async function resolveOnboardingCatalog(supabase: SupabaseClient): Promise<OnboardingCatalog> {
  const [specialtiesRes, subspecialtiesRes] = await Promise.all([
    supabase.from('specialties').select('key, label').order('label', { ascending: true }),
    supabase.from('subspecialties').select('key, label, specialty_id'),
  ]);
  if (specialtiesRes.error || subspecialtiesRes.error) {
    if (isMissingSchemaError(specialtiesRes.error || subspecialtiesRes.error)) {
      return {
        modules: ['admissions', 'adminAgent', 'scribe', 'billing'],
        specialties: [],
        subspecialties: [],
      };
    }
    console.error(
      '[practiceEntitlements] onboarding catalog lookup failed:',
      specialtiesRes.error?.message || subspecialtiesRes.error?.message
    );
    throw new Error('Failed to load onboarding catalog.');
  }

  const specialtiesById = new Map<string, { key: string; label: string }>();
  for (const raw of specialtiesRes.data || []) {
    const row = raw as { key: string; label: string; id?: string };
    if (row.id) specialtiesById.set(row.id, { key: row.key, label: row.label });
  }
  // Ensure we have ids for mapping subspecialties.
  const specialtiesWithIds = await supabase.from('specialties').select('id, key, label');
  if (!specialtiesWithIds.error) {
    for (const row of specialtiesWithIds.data || []) {
      specialtiesById.set((row as { id: string }).id, {
        key: (row as { key: string }).key,
        label: (row as { label: string }).label,
      });
    }
  }

  return {
    modules: ['admissions', 'adminAgent', 'scribe', 'billing'],
    specialties: (specialtiesRes.data || []) as Array<{ key: string; label: string }>,
    subspecialties: (subspecialtiesRes.data || [])
      .map((raw) => {
        const row = raw as { key: string; label: string; specialty_id: string };
        const specialty = specialtiesById.get(row.specialty_id);
        if (!specialty) return null;
        return { key: row.key, label: row.label, specialtyKey: specialty.key };
      })
      .filter(Boolean) as Array<{ key: string; label: string; specialtyKey: string }>,
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

  const membership = await ensurePracticeMembershipByEmail(supabase, email);

  const practiceRow = membership.practices;
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
  const selectedModules = { ...modules };
  let autoModules = { ...DEFAULT_USER_MODULES };
  let profile: OnboardingProfile | null = null;

  const onboarding = membership;
  if (onboarding?.specialty_id) {
    const specialtyDefaultsRes = await supabase
      .from('specialty_module_defaults')
      .select('admissions, admin_agent, scribe, billing')
      .eq('specialty_id', onboarding.specialty_id)
      .maybeSingle();
    if (specialtyDefaultsRes.error && !isMissingSchemaError(specialtyDefaultsRes.error)) {
      console.error('[practiceEntitlements] specialty_module_defaults lookup failed:', specialtyDefaultsRes.error.message);
      throw new Error('Failed to load practice entitlements.');
    }
    if (!specialtyDefaultsRes.error) {
      autoModules = orModules(autoModules, practiceFeatureRowToSettings(specialtyDefaultsRes.data));
    }
  }
  if (onboarding?.subspecialty_id) {
    const subspecialtyDefaultsRes = await supabase
      .from('subspecialty_module_defaults')
      .select('admissions, admin_agent, scribe, billing')
      .eq('subspecialty_id', onboarding.subspecialty_id)
      .maybeSingle();
    if (subspecialtyDefaultsRes.error && !isMissingSchemaError(subspecialtyDefaultsRes.error)) {
      console.error(
        '[practiceEntitlements] subspecialty_module_defaults lookup failed:',
        subspecialtyDefaultsRes.error.message
      );
      throw new Error('Failed to load practice entitlements.');
    }
    if (!subspecialtyDefaultsRes.error) {
      autoModules = orModules(autoModules, practiceFeatureRowToSettings(subspecialtyDefaultsRes.data));
    }
  }

  if (onboarding) {
    const [specialtyRes, subspecialtyRes] = await Promise.all([
      onboarding.specialty_id
        ? supabase.from('specialties').select('key').eq('id', onboarding.specialty_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      onboarding.subspecialty_id
        ? supabase.from('subspecialties').select('key').eq('id', onboarding.subspecialty_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if ((specialtyRes.error && !isMissingSchemaError(specialtyRes.error)) || (subspecialtyRes.error && !isMissingSchemaError(subspecialtyRes.error))) {
      console.error(
        '[practiceEntitlements] specialty/subspecialty key lookup failed:',
        specialtyRes.error?.message || subspecialtyRes.error?.message
      );
      throw new Error('Failed to load practice entitlements.');
    }
    profile = {
      role: sanitizeRole(onboarding.role),
      specialtyKey: String((specialtyRes.data as { key?: string } | null)?.key || ''),
      subspecialtyKey: (subspecialtyRes.data as { key?: string } | null)?.key || null,
      completedAt: onboarding.onboarding_completed_at,
    };
  }

  const desiredModules = orModules(selectedModules, autoModules);
  const effectiveModules = andModules(modules, desiredModules);
  const registry = loadExtensionRegistry();
  const effective = resolveEffectiveFeatureFlags(
    normalizeUserSettings({ modules: effectiveModules }),
    registry
  );

  return {
    effective,
    selectedModules,
    autoModules,
    modules: effectiveModules,
    practice: practiceRecord
      ? { id: practiceRecord.id, name: practiceRecord.name, slug: practiceRecord.slug }
      : { id: membership.practice_id, name: 'Practice', slug: membership.practice_id },
    onboardingRequired: !profile?.completedAt,
    profile,
    source: 'database',
  };
}

export async function getOnboardingStateForEmail(userEmail: string) {
  const email = normalizeEmail(userEmail);
  const supabase = getSupabase();
  if (!email || !supabase) {
    return {
      required: true,
      profile: null,
      selectedModules: { ...DEFAULT_USER_MODULES },
      autoModules: { ...DEFAULT_USER_MODULES },
      catalog: {
        modules: ['admissions', 'adminAgent', 'scribe', 'billing'] as OnboardingModuleKey[],
        specialties: [],
        subspecialties: [],
      },
    };
  }
  const [entitlements, catalog] = await Promise.all([
    getPracticeEntitlementsForEmail(email),
    resolveOnboardingCatalog(supabase),
  ]);
  return {
    required: entitlements.onboardingRequired,
    profile: entitlements.profile,
    selectedModules: entitlements.selectedModules,
    autoModules: entitlements.autoModules,
    catalog,
  };
}

export async function submitOnboardingForEmail(userEmail: string, input: SubmitOnboardingInput) {
  const email = normalizeEmail(userEmail);
  const supabase = getSupabase();
  if (!email || !supabase) {
    throw new Error('Onboarding is not configured.');
  }

  const specialty = await resolveEntityByKey(supabase, 'specialties', input.specialtyKey);
  if (!specialty) {
    throw new Error('Invalid specialty.');
  }
  let subspecialtyId: string | null = null;
  if (input.subspecialtyKey) {
    const subspecialty = await resolveEntityByKey(supabase, 'subspecialties', input.subspecialtyKey);
    if (!subspecialty) {
      throw new Error('Invalid subspecialty.');
    }
    const subspecialtyLink = await supabase
      .from('subspecialties')
      .select('specialty_id')
      .eq('id', subspecialty.id)
      .maybeSingle();
    if (subspecialtyLink.error || (subspecialtyLink.data as { specialty_id?: string } | null)?.specialty_id !== specialty.id) {
      throw new Error('Subspecialty does not belong to specialty.');
    }
    subspecialtyId = subspecialty.id;
  }

  const membership = await ensurePracticeMembershipByEmail(supabase, email);

  const { error: profileError } = await supabase
    .from('practice_users')
    .update({
      role: sanitizeRole(input.role),
      specialty_id: specialty.id,
      subspecialty_id: subspecialtyId,
      onboarding_completed_at: new Date().toISOString(),
    })
    .eq('email', email);
  if (profileError && isMissingSchemaError(profileError)) {
    // Temporary compatibility: save role even when onboarding columns are missing.
    const roleOnly = await supabase
      .from('practice_users')
      .update({ role: sanitizeRole(input.role) })
      .eq('email', email);
    if (!roleOnly.error) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } else {
      console.error('[practiceEntitlements] role fallback update failed:', roleOnly.error.message);
    }
  }

  const selectedModules = normalizeOnboardingSelection(input.selectedModules);
  const { error: practiceFeaturesError } = await supabase.from('practice_features').upsert(
    {
      practice_id: membership.practice_id,
      admissions: selectedModules.admissions,
      admin_agent: selectedModules.adminAgent,
      scribe: selectedModules.scribe,
      billing: selectedModules.billing,
    },
    { onConflict: 'practice_id' }
  );

  if ((profileError && !isMissingSchemaError(profileError)) || practiceFeaturesError) {
    console.error(
      '[practiceEntitlements] onboarding submit failed:',
      profileError?.message || practiceFeaturesError?.message
    );
    throw new Error('Failed to save onboarding.');
  }

  return getPracticeEntitlementsForEmail(email);
}
