import { randomUUID } from 'crypto';
import type { PdfDocumentType, PdfTemplateManifestEntry } from '../../shared/pdfFiller';
import {
  getInsuranceCompanyLabel,
  isInsuranceCompanyId,
} from '../../shared/insuranceCompanies';
import {
  driveRequest,
  getOrCreatePracticeAdminPdfDocumentsFolder,
  getOrCreatePracticePdfDocumentTypeFolder,
  getOrCreatePracticePdfInsurerFolder,
  moveDriveFile,
  uploadToDrive,
  upsertJsonFileInFolder,
} from './drive';
import { config } from '../config';
import {
  findTemplateEntry,
  loadPdfTemplatesManifest,
  savePdfTemplatesManifest,
} from './pdfTemplatesManifest';

function safeBaseName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim() || 'template';
  return base.replace(/[^\w\s.-]/g, '_').slice(0, 120);
}

function buildTemplateAppProperties(
  documentType: PdfDocumentType,
  pdfHash: string,
  insuranceCompanyId?: string
): Record<string, string> {
  const base: Record<string, string> = {
    document_type: documentType,
    pdf_hash: pdfHash,
  };
  if (documentType === 'insurance_form' && insuranceCompanyId) {
    base.insurance_company_id = insuranceCompanyId;
  }
  return base;
}

export async function resolvePracticePdfTemplateFolderId(
  token: string,
  documentType: PdfDocumentType,
  insuranceCompanyId?: string
): Promise<string> {
  const typeFolderId = await getOrCreatePracticePdfDocumentTypeFolder(token, documentType);
  if (documentType === 'insurance_form' && insuranceCompanyId && isInsuranceCompanyId(insuranceCompanyId)) {
    const label = getInsuranceCompanyLabel(insuranceCompanyId)!;
    return getOrCreatePracticePdfInsurerFolder(token, insuranceCompanyId, label, typeFolderId);
  }
  return typeFolderId;
}

async function replaceDriveFileContent(
  token: string,
  fileId: string,
  mimeType: string,
  buffer: Buffer,
  appProperties?: Record<string, string>
): Promise<void> {
  const res = await fetch(`${config.uploadApi}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mimeType,
    },
    body: buffer,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => 'Unknown update error');
    throw new Error(`[Drive ${res.status}] Failed to update file ${fileId}: ${errText}`);
  }
  if (appProperties) {
    await driveRequest(token, `/files/${fileId}`, {
      method: 'PATCH',
      body: JSON.stringify({ appProperties }),
    });
  }
}

async function patchDriveAppProperties(
  token: string,
  fileId: string,
  appProperties: Record<string, string>
): Promise<void> {
  await driveRequest(token, `/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify({ appProperties }),
  });
}

export interface SavePracticePdfTemplateInput {
  token: string;
  fileName: string;
  pdfBuffer: Buffer;
  pdfHash: string;
  schema: Record<string, unknown>;
  documentType: PdfDocumentType;
  displayName: string;
  templateId?: string;
  insuranceCompanyId?: string;
}

/**
 * Persists blank PDF + schema on the doctor's Drive and updates halo_pdf_templates.json.
 */
export async function savePracticePdfTemplate(
  input: SavePracticePdfTemplateInput
): Promise<PdfTemplateManifestEntry> {
  const {
    token,
    fileName,
    pdfBuffer,
    pdfHash,
    schema,
    documentType,
    displayName,
    templateId,
    insuranceCompanyId,
  } = input;

  const manifestRootId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
  const targetFolderId = await resolvePracticePdfTemplateFolderId(
    token,
    documentType,
    insuranceCompanyId
  );

  const stem = safeBaseName(fileName);
  const pdfFileName = `${stem}.pdf`;
  const schemaFileName = `${stem}.schema.json`;

  const extractionMethod = String(schema['x-extraction-method'] || 'human_corrected');
  const schemaVersion = Number(schema['x-schema-build-version'] || 1);
  const now = new Date().toISOString();

  const { manifest } = await loadPdfTemplatesManifest(token, manifestRootId);

  let entry =
    (templateId ? findTemplateEntry(manifest, templateId) : undefined) ??
    manifest.templates.find((t) => t.pdfHash === pdfHash);

  const typeProps = buildTemplateAppProperties(documentType, pdfHash, insuranceCompanyId);
  const pdfProps = { halo_pdf_template: '1', ...typeProps };
  const schemaProps = { halo_pdf_template_schema: '1', ...typeProps };

  const resolvedInsuranceId =
    documentType === 'insurance_form' ? insuranceCompanyId ?? entry?.insuranceCompanyId : undefined;

  if (entry) {
    const previousFolderId = await resolvePracticePdfTemplateFolderId(
      token,
      entry.documentType,
      entry.insuranceCompanyId
    );
    const hadPdf = Boolean(entry.pdfDriveFileId) && !entry.pdfPending;
    if (previousFolderId !== targetFolderId) {
      if (hadPdf) await moveDriveFile(token, entry.pdfDriveFileId, targetFolderId);
      await moveDriveFile(token, entry.schemaDriveFileId, targetFolderId);
    }

    let pdfDriveFileId = entry.pdfDriveFileId;
    if (hadPdf) {
      await replaceDriveFileContent(token, entry.pdfDriveFileId, 'application/pdf', pdfBuffer, pdfProps);
    } else {
      pdfDriveFileId = await uploadToDrive(
        token,
        pdfFileName,
        'application/pdf',
        targetFolderId,
        pdfBuffer,
        pdfProps
      );
    }
    const schemaDriveFileId = await upsertJsonFileInFolder(
      token,
      targetFolderId,
      schemaFileName,
      schema,
      schemaProps
    );
    entry = {
      ...entry,
      displayName,
      documentType,
      insuranceCompanyId: resolvedInsuranceId,
      pdfDriveFileId,
      schemaDriveFileId,
      pdfHash,
      pdfPending: false,
      extractionMethod,
      schemaVersion,
      updatedAt: now,
    };
    const idx = manifest.templates.findIndex((t) => t.templateId === entry!.templateId);
    if (idx >= 0) manifest.templates[idx] = entry;
  } else {
    const pdfDriveFileId = await uploadToDrive(
      token,
      pdfFileName,
      'application/pdf',
      targetFolderId,
      pdfBuffer,
      pdfProps
    );
    const schemaDriveFileId = await upsertJsonFileInFolder(
      token,
      targetFolderId,
      schemaFileName,
      schema,
      schemaProps
    );
    entry = {
      templateId: randomUUID(),
      displayName,
      documentType,
      insuranceCompanyId: resolvedInsuranceId,
      pdfDriveFileId,
      schemaDriveFileId,
      pdfHash,
      extractionMethod,
      schemaVersion,
      createdAt: now,
      updatedAt: now,
    };
    manifest.templates.push(entry);
  }

  await savePdfTemplatesManifest(token, manifestRootId, manifest);
  return entry;
}

export interface UpdatePracticePdfTemplateMetadataInput {
  token: string;
  templateId: string;
  displayName: string;
  documentType: PdfDocumentType;
  insuranceCompanyId?: string;
}

/**
 * Updates manifest metadata and moves Drive files when insurer/document type folder changes.
 */
export async function updatePracticePdfTemplateMetadata(
  input: UpdatePracticePdfTemplateMetadataInput
): Promise<PdfTemplateManifestEntry> {
  const { token, templateId, displayName, documentType, insuranceCompanyId } = input;

  const manifestRootId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
  const { manifest } = await loadPdfTemplatesManifest(token, manifestRootId);
  const entry = findTemplateEntry(manifest, templateId);
  if (!entry) {
    throw new Error('TEMPLATE_NOT_FOUND');
  }

  const targetFolderId = await resolvePracticePdfTemplateFolderId(
    token,
    documentType,
    insuranceCompanyId
  );
  const previousFolderId = await resolvePracticePdfTemplateFolderId(
    token,
    entry.documentType,
    entry.insuranceCompanyId
  );

  if (previousFolderId !== targetFolderId) {
    if (entry.pdfDriveFileId && !entry.pdfPending) {
      await moveDriveFile(token, entry.pdfDriveFileId, targetFolderId);
    }
    await moveDriveFile(token, entry.schemaDriveFileId, targetFolderId);
  }

  const resolvedInsuranceId =
    documentType === 'insurance_form' ? insuranceCompanyId : undefined;
  const pdfHash = entry.pdfHash ?? '';
  const typeProps = buildTemplateAppProperties(documentType, pdfHash, resolvedInsuranceId);
  if (entry.pdfDriveFileId && !entry.pdfPending) {
    await patchDriveAppProperties(token, entry.pdfDriveFileId, {
      halo_pdf_template: '1',
      ...typeProps,
    });
  }
  await patchDriveAppProperties(token, entry.schemaDriveFileId, {
    halo_pdf_template_schema: '1',
    ...typeProps,
  });

  const now = new Date().toISOString();
  const updated: PdfTemplateManifestEntry = {
    ...entry,
    displayName,
    documentType,
    insuranceCompanyId: resolvedInsuranceId,
    updatedAt: now,
  };
  const idx = manifest.templates.findIndex((t) => t.templateId === templateId);
  if (idx >= 0) manifest.templates[idx] = updated;

  await savePdfTemplatesManifest(token, manifestRootId, manifest);
  return updated;
}

export interface ImportSharedFormSchemaInput {
  token: string;
  pdfHash: string;
  schema: Record<string, unknown>;
  documentType: PdfDocumentType;
  displayName: string;
  insuranceCompanyId?: string;
}

/** Adds a shared form layout to the practice manifest (PDF attach required later if pdfPending). */
export async function importSharedFormSchemaToPractice(
  input: ImportSharedFormSchemaInput
): Promise<PdfTemplateManifestEntry> {
  const { token, pdfHash, schema, documentType, displayName, insuranceCompanyId } = input;

  const manifestRootId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
  const targetFolderId = await resolvePracticePdfTemplateFolderId(
    token,
    documentType,
    insuranceCompanyId
  );

  const { manifest } = await loadPdfTemplatesManifest(token, manifestRootId);
  const existing = manifest.templates.find((t) => t.pdfHash === pdfHash);
  if (existing && !existing.pdfPending) {
    return existing;
  }

  const extractionMethod = String(schema['x-extraction-method'] || 'shared_import');
  const schemaVersion = Number(schema['x-schema-build-version'] || 1);
  const now = new Date().toISOString();
  const stem = safeBaseName(displayName);
  const schemaFileName = `${stem}.schema.json`;
  const typeProps = buildTemplateAppProperties(documentType, pdfHash, insuranceCompanyId);
  const schemaProps = { halo_pdf_template_schema: '1', ...typeProps };

  const schemaDriveFileId = await upsertJsonFileInFolder(
    token,
    targetFolderId,
    schemaFileName,
    schema,
    schemaProps
  );

  let entry: PdfTemplateManifestEntry;
  if (existing?.pdfPending) {
    entry = {
      ...existing,
      displayName,
      documentType,
      insuranceCompanyId:
        documentType === 'insurance_form' ? insuranceCompanyId : undefined,
      schemaDriveFileId,
      extractionMethod,
      schemaVersion,
      updatedAt: now,
    };
    const idx = manifest.templates.findIndex((t) => t.templateId === existing.templateId);
    if (idx >= 0) manifest.templates[idx] = entry;
  } else {
    entry = {
      templateId: randomUUID(),
      displayName,
      documentType,
      insuranceCompanyId:
        documentType === 'insurance_form' ? insuranceCompanyId : undefined,
      pdfDriveFileId: '',
      schemaDriveFileId,
      pdfHash,
      pdfPending: true,
      extractionMethod,
      schemaVersion,
      createdAt: now,
      updatedAt: now,
    };
    manifest.templates.push(entry);
  }

  await savePdfTemplatesManifest(token, manifestRootId, manifest);
  return entry;
}
