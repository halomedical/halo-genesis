import type { UserModulesSettings } from './types';

/** Single-row shape stored in `practice_features`. */
export interface PracticeFeaturesRow {
  admissions: boolean;
  admin_agent: boolean;
  scribe: boolean;
  billing: boolean;
}

export function practiceFeatureRowToSettings(
  row: Partial<PracticeFeaturesRow> | null | undefined
): UserModulesSettings {
  return {
    admissions: Boolean(row?.admissions),
    adminAgent: Boolean(row?.admin_agent),
    scribe: Boolean(row?.scribe),
    billing: Boolean(row?.billing),
  };
}
