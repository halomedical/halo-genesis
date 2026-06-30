import type {
  PatientSummaryDiagnosis,
  PatientSummaryMedication,
  PatientSummaryState,
} from '../../shared/types';
import type { PdfSchemaFieldDescriptor } from '../utils/pdfSchemaUtils';

function labelBlob(key: string, title: string): string {
  return `${key} ${title}`.toLowerCase();
}

function clean(value: string | undefined | null): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function formatSex(sex: string | undefined): string | null {
  if (!sex) return null;
  const s = sex.trim().toUpperCase();
  if (s === 'M' || s === 'MALE') return 'Male';
  if (s === 'F' || s === 'FEMALE') return 'Female';
  return sex.trim();
}

function isActiveMedication(med: PatientSummaryMedication): boolean {
  const status = (med.status || '').toLowerCase();
  if (!status) return true;
  return !/(historic|historical|stopped|discontinued|inactive)/.test(status);
}

function formatMedicationLine(med: PatientSummaryMedication): string {
  return [med.name, med.strength, med.dosage, med.frequency].filter(Boolean).join(' ').trim();
}

function pickPrimaryDiagnosis(diagnoses: PatientSummaryDiagnosis[]): PatientSummaryDiagnosis | null {
  if (diagnoses.length === 0) return null;
  const primary = diagnoses.find((d) => /primary/i.test(d.status || ''));
  if (primary) return primary;
  const active = diagnoses.find((d) => /active/i.test(d.status || ''));
  return active || diagnoses[0];
}

function joinActiveMedications(medications: PatientSummaryMedication[]): string | null {
  const lines = medications.filter(isActiveMedication).map(formatMedicationLine).filter(Boolean);
  return lines.length > 0 ? lines.join('; ') : null;
}

function joinDiagnosisList(diagnoses: PatientSummaryDiagnosis[], max = 5): string | null {
  const parts = diagnoses
    .slice(0, max)
    .map((d) => {
      const code = d.icd10Code ? ` (${d.icd10Code})` : '';
      return `${d.description}${code}`.trim();
    })
    .filter(Boolean);
  return parts.length > 0 ? parts.join('; ') : null;
}

function snapshotText(state: PatientSummaryState): string | null {
  if (state.snapshot.length === 0) return null;
  return state.snapshot.slice(0, 5).join('\n');
}

function profileValueForLabel(
  label: string,
  profile: PatientSummaryState['profile']
): string | null {
  if (
    label.includes('patient name') ||
    label.includes('full name') ||
    (label.includes('name') &&
      !label.includes('scheme') &&
      !label.includes('plan') &&
      !label.includes('doctor') &&
      !label.includes('physician') &&
      !label.includes('clinician') &&
      !/\b(surname|last name|medical|treating)\b/.test(label))
  ) {
    return clean(profile.fullName);
  }
  if (label.includes('first name') || label.includes('given name')) {
    return clean(profile.firstName);
  }
  if (label.includes('surname') || label.includes('last name')) {
    return clean(profile.surname);
  }
  if (label.includes('initial')) {
    return clean(profile.initials);
  }
  if (label.includes('title') && (label.includes('patient') || label.includes('mr') || label.includes('mrs'))) {
    return clean(profile.title);
  }
  if (label.includes('id number') || label.includes('identity') || label.includes('id no')) {
    return clean(profile.idNumber);
  }
  if (label.includes('passport')) {
    return clean(profile.passportNumber);
  }
  if (label.includes('date of birth') || label.includes('dob') || label.includes('birth date')) {
    return clean(profile.dob);
  }
  if (label.includes('sex') || label.includes('gender')) {
    return formatSex(profile.sex);
  }
  if (
    label.includes('medical aid number') ||
    label.includes('member number') ||
    label.includes('membership')
  ) {
    return clean(profile.medicalAidNumber);
  }
  if (label.includes('medical aid') || label.includes('medical scheme')) {
    if (!label.includes('number')) return clean(profile.medicalAid);
  }
  if (label.includes('scheme') && !label.includes('plan')) {
    return clean(profile.medicalAid);
  }
  if (label.includes('plan') && !label.includes('explain')) {
    return clean(profile.medicalAidPlan);
  }
  if (label.includes('dependant') || label.includes('dependent')) {
    return clean(profile.dependantDetails);
  }
  if (label.includes('folder') || label.includes('file number')) {
    return clean(profile.folderNumber);
  }
  if (label.includes('cell') || label.includes('mobile') || label.includes('contact')) {
    if (label.includes('work')) return clean(profile.workContact);
    if (label.includes('home')) return clean(profile.homeContact);
    return clean(profile.contact);
  }
  if (label.includes('email')) {
    return clean(profile.email);
  }
  if (label.includes('physical address') || (label.includes('address') && !label.includes('postal'))) {
    return clean(profile.address);
  }
  if (label.includes('postal')) {
    return clean(profile.postalAddress);
  }
  if (label.includes('comorbid') || label.includes('co-morbid')) {
    return clean(profile.comorbidities);
  }
  return null;
}

function structuredValueForLabel(label: string, state: PatientSummaryState): string | null {
  const facts = state.structuredFacts;
  const primary = pickPrimaryDiagnosis(facts.diagnoses);

  if (label.includes('icd') && (label.includes('10') || label.includes('code'))) {
    return clean(primary?.icd10Code);
  }
  if (
    label.includes('diagnosis') ||
    label.includes('diagnoses') ||
    label.includes('condition') ||
    label.includes('primary diagnosis')
  ) {
    if (label.includes('all') || label.includes('list') || label.includes('index')) {
      return joinDiagnosisList(facts.diagnoses);
    }
    return clean(primary?.description);
  }
  if (
    label.includes('medication') ||
    label.includes('medicine') ||
    label.includes('drug') ||
    label.includes('current rx') ||
    label.includes('prescription')
  ) {
    return joinActiveMedications(facts.medications);
  }
  if (label.includes('allerg')) {
    return clean(state.profile.comorbidities);
  }
  if (
    label.includes('clinical summary') ||
    label.includes('current snapshot') ||
    label.includes('snapshot')
  ) {
    return snapshotText(state);
  }
  if (
    label.includes('history') ||
    label.includes('presenting') ||
    label.includes('complaint') ||
    label.includes('clinical note')
  ) {
    const snap = snapshotText(state);
    if (snap) return snap;
    const newest = [...state.timeline].sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))[0];
    if (newest?.bullets?.length) return newest.bullets.join('; ');
  }
  if (label.includes('procedure') || label.includes('operation')) {
    const names = facts.procedures.map((p) => p.name).filter(Boolean);
    return names.length > 0 ? names.slice(0, 5).join('; ') : null;
  }
  if (label.includes('hospital') || label.includes('admission')) {
    const row = facts.hospitalizations[0];
    if (!row) return null;
    if (label.includes('date')) return clean(row.admissionDate);
    if (label.includes('institution')) return clean(row.institution);
    return clean(row.reason);
  }
  if (label.includes('investigation') || label.includes('pathology') || label.includes('lab')) {
    const inv = facts.investigations[0];
    if (!inv) return null;
    return clean(inv.result || inv.name);
  }
  const treating = facts.careProfessionals.find((p) => /treat|refer|doctor|gp/i.test(p.role));
  if (
    treating &&
    (label.includes('treating') || label.includes('referring') || label.includes('gp'))
  ) {
    return clean(treating.name);
  }
  return null;
}

function valueForField(field: PdfSchemaFieldDescriptor, state: PatientSummaryState): string | null {
  const label = labelBlob(field.id, field.title);
  const fromProfile = profileValueForLabel(label, state.profile);
  if (fromProfile) return fromProfile;
  return structuredValueForLabel(label, state);
}

/** Rule-based autofill from `halo_patient_summary_state.json` only (no LLM). */
export function prefillFromSummaryState(
  schemaFields: PdfSchemaFieldDescriptor[],
  state: PatientSummaryState
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of schemaFields) {
    if (!field.id) continue;
    out[field.id] = valueForField(field, state);
  }
  return out;
}

export function fieldsNeedingLlm(
  schemaFields: PdfSchemaFieldDescriptor[],
  ruleValues: Record<string, string | null>
): PdfSchemaFieldDescriptor[] {
  return schemaFields.filter((field) => {
    if (!field.id) return false;
    const v = ruleValues[field.id];
    return v === null || v === undefined || String(v).trim() === '';
  });
}
