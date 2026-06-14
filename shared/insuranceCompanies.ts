export interface InsuranceCompany {
  id: string;
  label: string;
}

/** Curated South African medical schemes — extend in this file only. */
export const INSURANCE_COMPANIES: InsuranceCompany[] = [
  { id: 'discovery', label: 'Discovery Health' },
  { id: 'gems', label: 'GEMS' },
  { id: 'bonitas', label: 'Bonitas' },
  { id: 'momentum', label: 'Momentum Health' },
  { id: 'medihelp', label: 'Medihelp' },
  { id: 'fedhealth', label: 'Fedhealth' },
  { id: 'bestmed', label: 'Bestmed' },
  { id: 'sizwe', label: 'Sizwe Hosmed' },
  { id: 'keyhealth', label: 'KeyHealth' },
  { id: 'compcare', label: 'CompCare' },
  { id: 'polmed', label: 'Polmed' },
  { id: 'bankmed', label: 'Bankmed' },
  { id: 'profmed', label: 'Profmed' },
  { id: 'medshield', label: 'Medshield' },
  { id: 'other', label: 'Other' },
];

const byId = new Map(INSURANCE_COMPANIES.map((c) => [c.id, c]));

export function isInsuranceCompanyId(value: string): value is InsuranceCompany['id'] {
  return byId.has(value);
}

export function getInsuranceCompanyLabel(id: string | undefined | null): string | null {
  if (!id) return null;
  return byId.get(id)?.label ?? null;
}

/** Label for UI when manifest has no insurer set. */
export const UNCATEGORIZED_INSURER_LABEL = 'Uncategorized';

/** Returns error message when insurance_form requires a valid company id. */
export function validateInsuranceCompanyForDocumentType(
  documentType: string,
  insuranceCompanyId: string | undefined | null
): string | null {
  if (documentType !== 'insurance_form') return null;
  const id = insuranceCompanyId?.trim();
  if (!id || !isInsuranceCompanyId(id)) {
    return 'A valid insurance company is required for insurance forms.';
  }
  return null;
}
