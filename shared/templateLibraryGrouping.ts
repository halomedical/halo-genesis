import type { PdfDocumentType, PdfTemplateManifestEntry } from './pdfFiller';
import { PDF_DOCUMENT_TYPES } from './pdfFiller';
import { getInsuranceCompanyLabel, UNCATEGORIZED_INSURER_LABEL } from './insuranceCompanies';

export function countTemplatesByDocumentType(
  templates: PdfTemplateManifestEntry[]
): Map<PdfDocumentType, number> {
  const map = new Map<PdfDocumentType, number>();
  for (const t of PDF_DOCUMENT_TYPES) map.set(t, 0);
  for (const t of templates) {
    map.set(t.documentType, (map.get(t.documentType) ?? 0) + 1);
  }
  return map;
}

export function templatesForDocumentType(
  templates: PdfTemplateManifestEntry[],
  documentType: PdfDocumentType
): PdfTemplateManifestEntry[] {
  return templates.filter((t) => t.documentType === documentType);
}

export function countTemplatesByInsurer(
  templates: PdfTemplateManifestEntry[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of templates) {
    const key = t.insuranceCompanyId ?? '';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

export function insurerGroupLabel(insuranceCompanyId: string): string {
  if (!insuranceCompanyId) return UNCATEGORIZED_INSURER_LABEL;
  return getInsuranceCompanyLabel(insuranceCompanyId) ?? insuranceCompanyId;
}

export function templatesForInsurer(
  templates: PdfTemplateManifestEntry[],
  insuranceCompanyId: string
): PdfTemplateManifestEntry[] {
  return templates.filter((t) => (t.insuranceCompanyId ?? '') === insuranceCompanyId);
}

export function sortedInsurerKeys(templates: PdfTemplateManifestEntry[]): string[] {
  const keys = [...countTemplatesByInsurer(templates).keys()];
  return keys.sort((a, b) => insurerGroupLabel(a).localeCompare(insurerGroupLabel(b)));
}
