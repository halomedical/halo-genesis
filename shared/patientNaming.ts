/** Tokens available in patient folder / display templates */
export const PATIENT_NAME_TOKENS = [
  'name',
  'first_name',
  'last_name',
  'dob',
  'dob_compact',
  'sex',
  'folder_number',
  'id_number',
  'member_number',
] as const;

export type PatientNameToken = (typeof PATIENT_NAME_TOKENS)[number];

export type PatientNameSplitMode = 'last_token_is_surname' | 'first_token_is_surname';
export type PatientMissingFieldBehavior = 'omit' | 'placeholder' | 'fallback_default';

export interface PatientNamingConfig {
  id: string;
  label: string;
  /** Drive folder name template. Default: "{name}__{dob}__{sex}" */
  folderTemplate: string;
  /** UI primary label template. Default: "{name}" */
  displayTemplate: string;
  /** Optional secondary line (Sidebar subtitle, etc.). Default: "{dob}" */
  subtitleTemplate?: string;
  /** How to derive first/last when only `name` exists */
  nameSplit?: PatientNameSplitMode;
  /** What to emit when a token is missing */
  missingFieldBehavior?: PatientMissingFieldBehavior;
  /** Placeholder text when missingFieldBehavior is 'placeholder' */
  missingPlaceholder?: string;
}

export const DEFAULT_PATIENT_NAMING: PatientNamingConfig = {
  id: 'halo_default',
  label: 'HALO default',
  folderTemplate: '{name}__{dob}__{sex}',
  displayTemplate: '{name}',
  subtitleTemplate: '{dob}',
  nameSplit: 'last_token_is_surname',
  missingFieldBehavior: 'fallback_default',
  missingPlaceholder: 'Unknown',
};

export const PATIENT_NAMING_PRESETS: PatientNamingConfig[] = [
  DEFAULT_PATIENT_NAMING,
  {
    id: 'last_first_dob',
    label: 'Last, First (DOB)',
    folderTemplate: '{last_name}_{first_name}__{dob}__{sex}',
    displayTemplate: '{last_name}, {first_name}',
    subtitleTemplate: '{dob}',
    nameSplit: 'last_token_is_surname',
    missingFieldBehavior: 'fallback_default',
    missingPlaceholder: 'Unknown',
  },
  {
    id: 'folder_number_prefix',
    label: 'Folder # + Name',
    folderTemplate: '{folder_number}__{name}__{dob}__{sex}',
    displayTemplate: '{name}',
    subtitleTemplate: '{folder_number} · {dob}',
    nameSplit: 'last_token_is_surname',
    missingFieldBehavior: 'omit',
    missingPlaceholder: 'Unknown',
  },
];

export const CUSTOM_PATIENT_NAMING_ID = 'custom';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asTrimmedString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function asNameSplit(value: unknown): PatientNameSplitMode {
  return value === 'first_token_is_surname' ? 'first_token_is_surname' : 'last_token_is_surname';
}

function asMissingBehavior(value: unknown): PatientMissingFieldBehavior {
  if (value === 'omit' || value === 'placeholder' || value === 'fallback_default') {
    return value;
  }
  return 'fallback_default';
}

/** Normalize a partial / unknown config into a complete PatientNamingConfig. */
export function normalizePatientNamingConfig(
  value: Partial<PatientNamingConfig> | null | undefined,
  fallback: PatientNamingConfig = DEFAULT_PATIENT_NAMING
): PatientNamingConfig {
  const raw = isObject(value) ? value : {};
  return {
    id: asTrimmedString(raw.id, fallback.id),
    label: asTrimmedString(raw.label, fallback.label),
    folderTemplate: asTrimmedString(raw.folderTemplate, fallback.folderTemplate),
    displayTemplate: asTrimmedString(raw.displayTemplate, fallback.displayTemplate),
    subtitleTemplate: asTrimmedString(
      raw.subtitleTemplate,
      fallback.subtitleTemplate || '{dob}'
    ),
    nameSplit: asNameSplit(raw.nameSplit ?? fallback.nameSplit),
    missingFieldBehavior: asMissingBehavior(
      raw.missingFieldBehavior ?? fallback.missingFieldBehavior
    ),
    missingPlaceholder: asTrimmedString(
      raw.missingPlaceholder,
      fallback.missingPlaceholder || 'Unknown'
    ),
  };
}

export function getPatientNamingPreset(id: string | null | undefined): PatientNamingConfig | null {
  if (!id) return null;
  return PATIENT_NAMING_PRESETS.find((preset) => preset.id === id) || null;
}

/**
 * Resolve the active naming config from settings fields.
 * Prefers an explicit patientNamingConfig (including custom), then preset id, then default.
 */
export function resolvePatientNaming(input: {
  patientNamingId?: string | null;
  patientNamingConfig?: Partial<PatientNamingConfig> | null;
} | null | undefined): PatientNamingConfig {
  const explicit = input?.patientNamingConfig;
  if (explicit && typeof explicit === 'object') {
    const base =
      getPatientNamingPreset(
        typeof explicit.id === 'string' ? explicit.id : input?.patientNamingId
      ) || DEFAULT_PATIENT_NAMING;
    return normalizePatientNamingConfig(explicit, base);
  }

  const fromId = getPatientNamingPreset(input?.patientNamingId);
  if (fromId) return normalizePatientNamingConfig(fromId);

  return normalizePatientNamingConfig(DEFAULT_PATIENT_NAMING);
}
