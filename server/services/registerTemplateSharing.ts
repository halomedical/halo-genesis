import type { Request } from 'express';
import type { PdfTemplateManifestEntry } from '../../shared/pdfFiller';
import {
  isFormTemplateCacheConfigured,
  upsertGlobalSchema,
} from './formTemplateCache';
import {
  practiceShareKeyFromEmail,
  upsertSharedFormCatalogEntry,
} from './sharedFormCatalogStore';

export async function registerTemplateSharing(
  req: Request,
  params: {
    pdfHash: string;
    schema: Record<string, unknown>;
    entry: PdfTemplateManifestEntry;
    keepPrivate: boolean;
  }
): Promise<void> {
  const extractionMethod = params.entry.extractionMethod;
  const schemaVersion = params.entry.schemaVersion;

  if (isFormTemplateCacheConfigured()) {
    await upsertGlobalSchema({
      pdf_hash: params.pdfHash,
      schema_json: params.schema,
      extraction_method: extractionMethod,
      schema_version: schemaVersion,
    });
  }

  const email = req.session.userEmail?.trim();
  if (!email) return;

  await upsertSharedFormCatalogEntry({
    pdfHash: params.pdfHash,
    displayName: params.entry.displayName,
    documentType: params.entry.documentType,
    insuranceCompanyId: params.entry.insuranceCompanyId,
    sharedBy: practiceShareKeyFromEmail(email),
    isPublic: !params.keepPrivate,
    schemaVersion,
    extractionMethod,
  });
}
