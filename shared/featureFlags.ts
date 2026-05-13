import { DEFAULT_USER_MODULES, type UserSettings } from './types';

export interface ExtensionRegistryEntry {
  id: string;
  required_config_keys?: string[];
}

export interface EffectiveFeatureFlags {
  admissions: boolean;
  adminAgent: boolean;
  scribe: boolean;
  billing: boolean;
}

function isRequiredConfigKeyEnabled(settings: UserSettings, key: string): boolean {
  const modules = settings.modules || DEFAULT_USER_MODULES;
  switch (key) {
    case 'features.admin_agent':
      return modules.adminAgent ?? false;
    case 'features.scribe':
      return modules.scribe ?? true;
    case 'features.billing':
      return modules.billing ?? false;
    case 'features.admissions':
      return modules.admissions ?? false;
    default:
      return false;
  }
}

function isRegistryModuleEnabled(settings: UserSettings, entry?: ExtensionRegistryEntry): boolean {
  if (!entry) return false;
  const requiredKeys = entry.required_config_keys || [];
  if (requiredKeys.length === 0) return true;
  return requiredKeys.every((key) => isRequiredConfigKeyEnabled(settings, key));
}

export function resolveEffectiveFeatureFlags(
  settings: UserSettings,
  registry: ExtensionRegistryEntry[]
): EffectiveFeatureFlags {
  const byId = new Map(registry.map((entry) => [entry.id, entry] as const));
  const modules = settings.modules || DEFAULT_USER_MODULES;

  const adminAgent = (modules.adminAgent ?? false) && isRegistryModuleEnabled(settings, byId.get('admin-agent-v1'));
  const scribe = (modules.scribe ?? true) && isRegistryModuleEnabled(settings, byId.get('scribe-agent-v1'));
  const billing = (modules.billing ?? false) && isRegistryModuleEnabled(settings, byId.get('billing-agent-v1'));

  return {
    admissions: modules.admissions ?? false,
    adminAgent,
    scribe,
    billing,
  };
}
