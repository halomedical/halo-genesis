import {
  EMPTY_PDF_TEMPLATES_MANIFEST,
  HALO_PDF_TEMPLATES_MANIFEST,
  type PdfTemplateManifestEntry,
  type PdfTemplatesManifest,
} from '../../shared/pdfFiller';
import {
  findFileInFolder,
  readJsonFileFromDrive,
  upsertJsonFileInFolder,
} from './drive';

export async function loadPdfTemplatesManifest(
  token: string,
  pdfDocumentsFolderId: string
): Promise<{ manifest: PdfTemplatesManifest; manifestFileId: string | null }> {
  const existing = await findFileInFolder(
    token,
    pdfDocumentsFolderId,
    HALO_PDF_TEMPLATES_MANIFEST,
    'application/json'
  );

  if (!existing?.id) {
    return { manifest: { ...EMPTY_PDF_TEMPLATES_MANIFEST }, manifestFileId: null };
  }

  const manifest = await readJsonFileFromDrive<PdfTemplatesManifest>(
    token,
    existing.id,
    { ...EMPTY_PDF_TEMPLATES_MANIFEST }
  );

  if (manifest.type !== 'halo_pdf_templates' || !Array.isArray(manifest.templates)) {
    return { manifest: { ...EMPTY_PDF_TEMPLATES_MANIFEST }, manifestFileId: existing.id };
  }

  return { manifest, manifestFileId: existing.id };
}

export async function savePdfTemplatesManifest(
  token: string,
  pdfDocumentsFolderId: string,
  manifest: PdfTemplatesManifest
): Promise<string> {
  return upsertJsonFileInFolder(
    token,
    pdfDocumentsFolderId,
    HALO_PDF_TEMPLATES_MANIFEST,
    manifest,
    { halo_type: 'pdf_templates_manifest' }
  );
}

export function findTemplateEntry(
  manifest: PdfTemplatesManifest,
  templateId: string
): PdfTemplateManifestEntry | undefined {
  return manifest.templates.find((t) => t.templateId === templateId);
}
