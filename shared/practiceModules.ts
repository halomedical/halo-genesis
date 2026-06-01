import type { UserModulesSettings } from './types';

/** Module ids stored in `practice_features.module`. */
export type PracticeModuleId = 'admissions' | 'admin_agent' | 'scribe' | 'billing';

export const PRACTICE_MODULE_IDS: PracticeModuleId[] = [
  'admissions',
  'admin_agent',
  'scribe',
  'billing',
];

const MODULE_TO_SETTINGS_KEY: Record<PracticeModuleId, keyof UserModulesSettings> = {
  admissions: 'admissions',
  admin_agent: 'adminAgent',
  scribe: 'scribe',
  billing: 'billing',
};

export function practiceModuleRowsToSettings(
  rows: Array<{ module: string; enabled: boolean }>
): UserModulesSettings {
  const modules: UserModulesSettings = {
    admissions: false,
    adminAgent: false,
    scribe: false,
    billing: false,
  };

  for (const row of rows) {
    const key = MODULE_TO_SETTINGS_KEY[row.module as PracticeModuleId];
    if (key) {
      modules[key] = Boolean(row.enabled);
    }
  }

  return modules;
}
