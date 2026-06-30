import type { PatientSubfolder } from './folderStructure';

export const HALO_PDF_TEMPLATES_MANIFEST = 'halo_pdf_templates.json';

export const PDF_DOCUMENT_TYPES = [
  'insurance_form',
  'consent',
  'referral',
  'clinical_form',
  'other',
] as const;

export type PdfDocumentType = (typeof PDF_DOCUMENT_TYPES)[number];

export const PDF_DOCUMENT_TYPE_LABELS: Record<PdfDocumentType, string> = {
  insurance_form: 'Insurance Form',
  consent: 'Consent',
  referral: 'Referral',
  clinical_form: 'Clinical Form',
  other: 'Other',
};

/** Where filled PDFs are filed on the patient Drive tree. */
export const PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER: Record<PdfDocumentType, PatientSubfolder> = {
  insurance_form: 'Insurance Forms',
  consent: 'Letters',
  referral: 'Subspecialist Referral',
  clinical_form: 'Clerking Sheets',
  other: 'Scanned Documents',
};

export interface PdfTemplateManifestEntry {
  templateId: string;
  displayName: string;
  documentType: PdfDocumentType;
  /** Curated id from shared/insuranceCompanies — when documentType is insurance_form. */
  insuranceCompanyId?: string;
  /** When true, schema is on Drive but blank PDF must still be attached (shared import). */
  pdfPending?: boolean;
  pdfDriveFileId: string;
  schemaDriveFileId: string;
  /** MD5 hex of blank PDF bytes — used to upsert the same template from Form Studio. */
  pdfHash?: string;
  extractionMethod: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PdfTemplatesManifest {
  type: 'halo_pdf_templates';
  version: 1;
  templates: PdfTemplateManifestEntry[];
}

export const EMPTY_PDF_TEMPLATES_MANIFEST: PdfTemplatesManifest = {
  type: 'halo_pdf_templates',
  version: 1,
  templates: [],
};

export function isPdfDocumentType(value: string): value is PdfDocumentType {
  return (PDF_DOCUMENT_TYPES as readonly string[]).includes(value);
}
