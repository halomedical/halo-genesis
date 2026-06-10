import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/requireAuth';
import {
  downloadFileBuffer,
  getOrCreatePatientSubfolder,
  getOrCreatePracticeAdminPdfDocumentsFolder,
  sanitizeString,
  uploadToDrive,
  upsertJsonFileInFolder,
} from '../services/drive';
import {
  extractSchemaFromPdf,
  fillPdfViaSidecar,
  pdfFillerHealthCheck,
} from '../services/pdfFillerClient';
import {
  findTemplateEntry,
  loadPdfTemplatesManifest,
  savePdfTemplatesManifest,
} from '../services/pdfTemplatesManifest';
import {
  isPdfDocumentType,
  PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER,
  type PdfDocumentType,
  type PdfTemplateManifestEntry,
} from '../../shared/pdfFiller';

const router = Router();
router.use(requireAuth);

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function safeBaseName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim() || 'template';
  return base.replace(/[^\w\s.-]/g, '_').slice(0, 120);
}

router.get('/health', async (_req: Request, res: Response) => {
  const sidecarOk = await pdfFillerHealthCheck();
  res.status(sidecarOk ? 200 : 503).json({
    ok: sidecarOk,
    sidecarUrl: process.env.PDF_FILLER_SERVICE_URL || 'http://localhost:8000',
  });
});

router.get('/templates', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const folderId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
    const { manifest } = await loadPdfTemplatesManifest(token, folderId);
    res.json({ templates: manifest.templates });
  } catch (err) {
    console.error('[pdf-filler] list templates:', err);
    res.status(500).json({ error: 'Failed to load PDF templates.' });
  }
});

router.get('/templates/:templateId/schema', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const templateId = String(req.params.templateId);
    const folderId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
    const { manifest } = await loadPdfTemplatesManifest(token, folderId);
    const entry = findTemplateEntry(manifest, templateId);
    if (!entry) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }
    const schemaBuffer = await downloadFileBuffer(token, entry.schemaDriveFileId);
    const schema = JSON.parse(schemaBuffer.toString('utf-8'));
    res.json({ template: entry, schema });
  } catch (err) {
    console.error('[pdf-filler] get schema:', err);
    res.status(500).json({ error: 'Failed to load template schema.' });
  }
});

router.get('/templates/:templateId/pdf', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const templateId = String(req.params.templateId);
    const folderId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
    const { manifest } = await loadPdfTemplatesManifest(token, folderId);
    const entry = findTemplateEntry(manifest, templateId);
    if (!entry) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }
    const pdfBuffer = await downloadFileBuffer(token, entry.pdfDriveFileId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${entry.displayName}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('[pdf-filler] get pdf:', err);
    res.status(500).json({ error: 'Failed to load template PDF.' });
  }
});

router.post('/templates', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const fileName = sanitizeString(req.body.fileName, 255);
    const fileData = req.body.fileData as string;
    const documentTypeRaw = sanitizeString(req.body.documentType, 64);
    const displayNameInput = sanitizeString(req.body.displayName, 255);

    if (!fileName || !fileName.toLowerCase().endsWith('.pdf')) {
      res.status(400).json({ error: 'A PDF file name is required.' });
      return;
    }
    if (!isPdfDocumentType(documentTypeRaw)) {
      res.status(400).json({ error: 'Invalid document type.' });
      return;
    }
    if (!fileData || typeof fileData !== 'string') {
      res.status(400).json({ error: 'File data is required (base64).' });
      return;
    }

    const estimatedSize = Math.ceil(fileData.length * 3 / 4);
    if (estimatedSize > MAX_FILE_SIZE_BYTES) {
      res.status(400).json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE_MB}MB.` });
      return;
    }

    const pdfBuffer = Buffer.from(fileData, 'base64');
    const stem = safeBaseName(fileName);
    const displayName = displayNameInput || stem;
    const documentType = documentTypeRaw as PdfDocumentType;

    const schema = await extractSchemaFromPdf(pdfBuffer, fileName);
    const extractionMethod = String(schema['x-extraction-method'] || 'unknown');
    const schemaVersion = Number(schema['x-schema-build-version'] || 0);

    const folderId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
    const pdfDriveFileId = await uploadToDrive(
      token,
      `${stem}.pdf`,
      'application/pdf',
      folderId,
      pdfBuffer,
      { halo_pdf_template: '1', document_type: documentType }
    );
    const schemaDriveFileId = await upsertJsonFileInFolder(
      token,
      folderId,
      `${stem}.schema.json`,
      schema,
      { halo_pdf_template_schema: '1', document_type: documentType }
    );

    const { manifest } = await loadPdfTemplatesManifest(token, folderId);
    const now = new Date().toISOString();
    const entry: PdfTemplateManifestEntry = {
      templateId: randomUUID(),
      displayName,
      documentType,
      pdfDriveFileId,
      schemaDriveFileId,
      extractionMethod,
      schemaVersion,
      createdAt: now,
      updatedAt: now,
    };
    manifest.templates.push(entry);
    await savePdfTemplatesManifest(token, folderId, manifest);

    res.json({ template: entry });
  } catch (err) {
    console.error('[pdf-filler] upload template:', err);
    const message = err instanceof Error ? err.message : 'Upload failed.';
    if (message.includes('extract-schema failed')) {
      res.status(502).json({ error: 'PDF analysis service unavailable or failed.', detail: message });
      return;
    }
    res.status(500).json({ error: 'Failed to save PDF template.', detail: message });
  }
});

router.delete('/templates/:templateId', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const templateId = String(req.params.templateId);
    const folderId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
    const { manifest } = await loadPdfTemplatesManifest(token, folderId);
    const idx = manifest.templates.findIndex((t) => t.templateId === templateId);
    if (idx < 0) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }
    manifest.templates.splice(idx, 1);
    await savePdfTemplatesManifest(token, folderId, manifest);
    res.json({ success: true });
  } catch (err) {
    console.error('[pdf-filler] delete template:', err);
    res.status(500).json({ error: 'Failed to delete template.' });
  }
});

router.post('/patients/:patientId/fill', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const patientFolderId = String(req.params.patientId);
    const templateId = sanitizeString(req.body.templateId, 64);
    const answers = req.body.answers as Record<string, unknown> | undefined;

    if (!templateId) {
      res.status(400).json({ error: 'templateId is required.' });
      return;
    }
    if (!answers || typeof answers !== 'object') {
      res.status(400).json({ error: 'answers object is required.' });
      return;
    }

    const folderId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
    const { manifest } = await loadPdfTemplatesManifest(token, folderId);
    const entry = findTemplateEntry(manifest, templateId);
    if (!entry) {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }

    const [pdfBuffer, schemaBuffer] = await Promise.all([
      downloadFileBuffer(token, entry.pdfDriveFileId),
      downloadFileBuffer(token, entry.schemaDriveFileId),
    ]);
    const schema = JSON.parse(schemaBuffer.toString('utf-8')) as Record<string, unknown>;

    const filledPdf = await fillPdfViaSidecar(pdfBuffer, schema, answers);

    const subfolderName = PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER[entry.documentType];
    const targetFolderId = await getOrCreatePatientSubfolder(token, patientFolderId, subfolderName);
    const outName = `${entry.displayName} — filled ${new Date().toISOString().slice(0, 10)}.pdf`;
    const fileId = await uploadToDrive(
      token,
      outName,
      'application/pdf',
      targetFolderId,
      filledPdf,
      { halo_pdf_filled: '1', template_id: templateId }
    );

    res.json({
      fileId,
      name: outName,
      subfolder: subfolderName,
      templateId,
    });
  } catch (err) {
    console.error('[pdf-filler] fill:', err);
    const message = err instanceof Error ? err.message : 'Fill failed.';
    res.status(500).json({ error: 'Failed to generate filled PDF.', detail: message });
  }
});

export default router;
