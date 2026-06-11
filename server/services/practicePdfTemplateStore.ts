import { randomUUID } from 'crypto';
import type { PdfDocumentType, PdfTemplateManifestEntry } from '../../shared/pdfFiller';
import {
  driveRequest,
  getOrCreatePracticeAdminPdfDocumentsFolder,
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

export interface SavePracticePdfTemplateInput {
  token: string;
  fileName: string;
  pdfBuffer: Buffer;
  pdfHash: string;
  schema: Record<string, unknown>;
  documentType: PdfDocumentType;
  displayName: string;
  templateId?: string;
}

/**
 * Persists blank PDF + schema on the doctor's Drive and updates halo_pdf_templates.json.
 */
export async function savePracticePdfTemplate(
  input: SavePracticePdfTemplateInput
): Promise<PdfTemplateManifestEntry> {
  const { token, fileName, pdfBuffer, pdfHash, schema, documentType, displayName, templateId } =
    input;

  const folderId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
  const stem = safeBaseName(fileName);
  const pdfFileName = `${stem}.pdf`;
  const schemaFileName = `${stem}.schema.json`;

  const extractionMethod = String(schema['x-extraction-method'] || 'human_corrected');
  const schemaVersion = Number(schema['x-schema-build-version'] || 1);
  const now = new Date().toISOString();

  const { manifest } = await loadPdfTemplatesManifest(token, folderId);

  let entry =
    (templateId ? findTemplateEntry(manifest, templateId) : undefined) ??
    manifest.templates.find((t) => t.pdfHash === pdfHash);

  const pdfProps = { halo_pdf_template: '1', document_type: documentType, pdf_hash: pdfHash };
  const schemaProps = { halo_pdf_template_schema: '1', document_type: documentType, pdf_hash: pdfHash };

  if (entry) {
    await replaceDriveFileContent(token, entry.pdfDriveFileId, 'application/pdf', pdfBuffer, pdfProps);
    const schemaDriveFileId = await upsertJsonFileInFolder(
      token,
      folderId,
      schemaFileName,
      schema,
      schemaProps
    );
    entry = {
      ...entry,
      displayName,
      documentType,
      schemaDriveFileId,
      pdfHash,
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
      folderId,
      pdfBuffer,
      pdfProps
    );
    const schemaDriveFileId = await upsertJsonFileInFolder(
      token,
      folderId,
      schemaFileName,
      schema,
      schemaProps
    );
    entry = {
      templateId: randomUUID(),
      displayName,
      documentType,
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

  await savePdfTemplatesManifest(token, folderId, manifest);
  return entry;
}
