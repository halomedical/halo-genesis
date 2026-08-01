import {
  DEFAULT_PATIENT_NAMING,
  type PatientNameToken,
  type PatientNamingConfig,
} from './patientNaming';

/** Minimal demographic fields used by the naming engine (avoids circular imports with types). */
export interface PatientNamingFields {
  name: string;
  dob: string;
  sex?: string;
  folderNumber?: string;
  idNumber?: string;
  memberNumber?: string;
  initials?: string;
  firstName?: string;
  lastName?: string;
}

const TOKEN_RE = /\{([a-z_]+)\}/g;

export function splitPatientName(
  fullName: string,
  mode: PatientNamingConfig['nameSplit'] = 'last_token_is_surname'
): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  if (mode === 'first_token_is_surname') {
    return { firstName: parts.slice(1).join(' '), lastName: parts[0] };
  }
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function tokenValues(
  patient: PatientNamingFields,
  config: PatientNamingConfig
): Record<PatientNameToken, string> {
  const split = splitPatientName(patient.name || '', config.nameSplit);
  const first = (patient.firstName || '').trim() || split.firstName;
  const last = (patient.lastName || '').trim() || split.lastName;
  const dob = (patient.dob || '').trim();

  return {
    name: (patient.name || '').trim(),
    first_name: first,
    last_name: last,
    dob,
    dob_compact: dob.replace(/-/g, ''),
    sex: (patient.sex || '').trim(),
    folder_number: (patient.folderNumber || '').trim(),
    id_number: (patient.idNumber || '').trim(),
    member_number: (patient.memberNumber || '').trim(),
  };
}

function fallbackForToken(key: string, config: PatientNamingConfig): string {
  const behavior = config.missingFieldBehavior || 'fallback_default';
  if (behavior === 'placeholder') return config.missingPlaceholder || 'Unknown';
  if (behavior === 'omit') return '';
  // fallback_default — preserve historical create/list defaults
  if (key === 'dob' || key === 'dob_compact') return 'Unknown';
  if (key === 'sex') return 'M';
  return '';
}

function collapseOmittedSeparators(result: string): string {
  // Drop empty __-delimited segments without destroying intentional `__` separators.
  const collapsedSegments = result
    .split('__')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join('__');

  return collapsedSegments
    .replace(/\s*[·,]\s*(?=[·,]|$)/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,·-]+|[\s,·-]+$/g, '')
    .trim();
}

export function applyPatientNamingTemplate(
  template: string,
  patient: PatientNamingFields,
  config: PatientNamingConfig = DEFAULT_PATIENT_NAMING
): string {
  const values = tokenValues(patient, config);
  const behavior = config.missingFieldBehavior || 'fallback_default';

  let result = template.replace(TOKEN_RE, (_, key: string) => {
    const value = (values[key as PatientNameToken] ?? '').trim();
    if (value) return value;
    return fallbackForToken(key, config);
  });

  if (behavior === 'omit') {
    result = collapseOmittedSeparators(result);
  }

  return result.trim();
}

export function formatPatientFolderName(
  patient: PatientNamingFields,
  config: PatientNamingConfig = DEFAULT_PATIENT_NAMING
): string {
  const encoded = applyPatientNamingTemplate(config.folderTemplate, patient, config);
  // Drive folder names must not be empty
  if (encoded) return encoded;
  const name = (patient.name || '').trim() || 'Unknown';
  const dob = (patient.dob || '').trim() || 'Unknown';
  const sex = (patient.sex || '').trim() || 'M';
  return `${name}__${dob}__${sex}`;
}

export function formatPatientDisplayName(
  patient: PatientNamingFields,
  config: PatientNamingConfig = DEFAULT_PATIENT_NAMING
): string {
  const display = applyPatientNamingTemplate(config.displayTemplate, patient, config);
  return display || (patient.name || '').trim() || 'Unknown';
}

export function formatPatientSubtitle(
  patient: PatientNamingFields,
  config: PatientNamingConfig = DEFAULT_PATIENT_NAMING
): string {
  const template = config.subtitleTemplate || '{dob}';
  return applyPatientNamingTemplate(template, patient, config);
}

/**
 * Legacy-compatible parse for the default "{name}__{dob}__{sex}" Drive encoding.
 * Custom templates should rely on appProperties; this remains for Drive renames
 * and auto-heal of the default encoding.
 */
export function parseFolderString(
  folderName: string
): { pName: string; pDob: string; pSex: string } | null {
  if (!folderName.includes('__')) return null;
  const parts = folderName.split('__');
  if (parts.length < 3) return null;

  let pName = parts[0];
  let pDob = parts[1];
  const pSex = parts[2];

  if (parts[0].includes('_')) {
    const nameParts = parts[0].split('_');
    if (nameParts.length > 1) {
      pName = `${nameParts[1]} ${nameParts[0]}`;
    } else {
      pName = parts[0].replace('_', ' ');
    }
    if (parts[1].includes('-')) {
      const d = parts[1].split('-');
      if (d[0].length === 2 && d[2]?.length === 4) {
        pDob = `${d[2]}-${d[1]}-${d[0]}`;
      }
    }
  }

  return { pName, pDob, pSex };
}
