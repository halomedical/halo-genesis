import type { Patient } from '../../../../../../shared/types';
import { findManuallyTypedFields, mergeHumanFieldDeltas } from '../../../../../../shared/patientFormDeltas';

export { findManuallyTypedFields, mergeHumanFieldDeltas };

type JsonSchemaProperty = {
  title?: string;
  type?: string;
  'x-data-source'?: string;
};

function allowsPatientRecordSource(prop: JsonSchemaProperty): boolean {
  const src = prop['x-data-source'];
  return !src || src === 'patient_record';
}

export interface ClinicianPrefillProfile {
  displayName: string;
  email: string;
  mpNumber: string;
  signatureText: string;
}

/** Best-effort map of extracted field labels/keys to patient chart data. */
export function mergePatientIntoFormValues(
  schema: Record<string, unknown>,
  values: Record<string, string | boolean>,
  patient: Patient
): Record<string, string | boolean> {
  const properties = (schema.properties || {}) as Record<string, JsonSchemaProperty>;
  const out = { ...values };

  const setIfEmpty = (key: string, value: string | undefined) => {
    if (!value?.trim()) return;
    const current = out[key];
    if (typeof current === 'string' && current.trim() !== '') return;
    if (properties[key]?.type === 'boolean') return;
    out[key] = value.trim();
  };

  for (const [key, prop] of Object.entries(properties)) {
    if (!allowsPatientRecordSource(prop)) continue;
    const label = `${key} ${prop.title ?? ''}`.toLowerCase();

    const looksLikePatientName =
      label.includes('patient name') ||
      label.includes('full name') ||
      (label.includes('name') &&
        !label.includes('scheme') &&
        !label.includes('plan') &&
        !/\b(surname|last name|medical)\b/.test(label));
    if (looksLikePatientName) {
      setIfEmpty(key, patient.name);
      continue;
    }
    if (label.includes('initial')) {
      setIfEmpty(key, patient.initials);
      continue;
    }
    if (label.includes('id number') || label.includes('identity') || label.includes('id no')) {
      setIfEmpty(key, patient.idNumber);
      continue;
    }
    if (label.includes('date of birth') || label.includes('dob') || label.includes('birth date')) {
      setIfEmpty(key, patient.dob);
      continue;
    }
    if (label.includes('medical aid number') || label.includes('member number') || label.includes('membership')) {
      setIfEmpty(key, patient.medicalAidNumber ?? patient.memberNumber);
      continue;
    }
    if (label.includes('medical aid') && !label.includes('number')) {
      setIfEmpty(key, patient.medicalAid);
      continue;
    }
    if (label.includes('scheme')) {
      setIfEmpty(key, patient.schemeCode ?? patient.medicalAid);
      continue;
    }
    if (label.includes('plan') && !label.includes('explain')) {
      setIfEmpty(key, patient.medicalAidPlan ?? patient.planCode);
      continue;
    }
    if (label.includes('folder') || label.includes('file number')) {
      setIfEmpty(key, patient.folderNumber);
      continue;
    }
    if (label.includes('sex') || label.includes('gender')) {
      setIfEmpty(key, patient.sex === 'M' ? 'Male' : patient.sex === 'F' ? 'Female' : patient.sex);
    }
  }

  return out;
}

/** Prefill clinician name, MP, and signature text for fields marked clinician_profile. */
export function mergeClinicianIntoFormValues(
  schema: Record<string, unknown>,
  values: Record<string, string | boolean>,
  profile: ClinicianPrefillProfile
): Record<string, string | boolean> {
  const properties = (schema.properties || {}) as Record<string, JsonSchemaProperty>;
  const out = { ...values };

  const setIfEmpty = (key: string, value: string | undefined) => {
    if (!value?.trim()) return;
    const current = out[key];
    if (typeof current === 'string' && current.trim() !== '') return;
    if (properties[key]?.type === 'boolean') return;
    out[key] = value.trim();
  };

  for (const [key, prop] of Object.entries(properties)) {
    if (prop['x-data-source'] !== 'clinician_profile') continue;
    const label = `${key} ${prop.title ?? ''}`.toLowerCase();
    if (label.includes('mp') || label.includes('practitioner') || label.includes('registration')) {
      setIfEmpty(key, profile.mpNumber);
      continue;
    }
    if (label.includes('signature') && !label.includes('date')) {
      setIfEmpty(key, profile.signatureText || profile.displayName);
      continue;
    }
    if (
      label.includes('doctor') ||
      label.includes('physician') ||
      label.includes('clinician') ||
      label.includes('treating') ||
      (label.includes('name') && !label.includes('patient'))
    ) {
      setIfEmpty(key, profile.displayName);
    }
  }

  return out;
}
