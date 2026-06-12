import { Router, Request, Response } from 'express';
import { config } from '../config';
import { requireAuth } from '../middleware/requireAuth';
import {
  downloadFileBuffer,
  getOrCreatePatientSubfolder,
  getOrCreatePracticeAdminPdfDocumentsFolder,
  sanitizeString,
  uploadToDrive,
} from '../services/drive';
import {
  handleExtractionRequest,
  handleFillRequest,
  handleApproveMapping,
  handlePublishPracticeTemplate,
  handleSaveTemplate,
} from '../controllers/pdfFillerController';
import { md5HexPdf } from '../services/pdfHash';
import { extractDataFromPatientSummary } from '../services/pdfFillerAutofill';
import {
  autofillFromPatientSummary,
  extractSchemaFromPdf,
  fillPdfViaSidecar,
  pdfFillerHealthCheck,
} from '../services/pdfFillerClient';
import {
  ensurePatientSummaryUpToDate,
  enrichPatientSummaryFromFormSubmission,
} from '../services/patientSummary';
import { schemaPropertiesToFields } from '../utils/pdfSchemaUtils';
import { savePracticePdfTemplate } from '../services/practicePdfTemplateStore';
import {
  getEstimatedExtractionDurationMs,
  insertPdfExtractionTelemetry,
  type PdfExtractionFlow,
} from '../services/pdfExtractionTelemetryStore';
import {
  findTemplateEntry,
  loadPdfTemplatesManifest,
  savePdfTemplatesManifest,
} from '../services/pdfTemplatesManifest';
import {
  isPdfDocumentType,
  PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER,
  type PdfDocumentType,
} from '../../shared/pdfFiller';

const router = Router();
router.use(requireAuth);

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

function safeBaseName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim() || 'template';
  return base.replace(/[^\w\s.-]/g, '_').slice(0, 120);
}

router.get('/extract/estimate', async (req: Request, res: Response) => {
  try {
    const fileSizeRaw = Number(req.query.fileSizeBytes);
    const flowRaw = String(req.query.flow || 'extract_api');

    if (!Number.isFinite(fileSizeRaw) || fileSizeRaw <= 0) {
      res.status(400).json({ error: 'fileSizeBytes must be a positive number.' });
      return;
    }
    if (fileSizeRaw > MAX_FILE_SIZE_BYTES) {
      res.status(400).json({ error: `fileSizeBytes exceeds ${MAX_FILE_SIZE_MB}MB limit.` });
      return;
    }
    if (flowRaw !== 'extract_api' && flowRaw !== 'template_upload') {
      res.status(400).json({ error: 'flow must be extract_api or template_upload.' });
      return;
    }

    const estimate = await getEstimatedExtractionDurationMs({
      fileSizeBytes: Math.round(fileSizeRaw),
      flow: flowRaw as PdfExtractionFlow,
    });
    res.json(estimate);
  } catch (err) {
    console.error('[pdf-filler] extract estimate:', err);
    res.status(500).json({ error: 'Failed to compute extraction estimate.' });
  }
});

router.post('/extract', (req, res) => void handleExtractionRequest(req, res));
router.post('/approve-mapping', (req, res) => void handleApproveMapping(req, res));
router.post('/schema/global', (req, res) => void handleSaveTemplate(req, res));
router.post('/templates/publish', (req, res) => void handlePublishPracticeTemplate(req, res));
router.post('/fill', (req, res) => void handleFillRequest(req, res));

router.get('/health', async (_req: Request, res: Response) => {
  const sidecarOk = await pdfFillerHealthCheck();
  res.status(sidecarOk ? 200 : 503).json({
    ok: sidecarOk,
    sidecarUrl: config.pdfFillerServiceUrl,
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
  const startedAt = performance.now();
  let fileSizeBytes = 0;
  let pdfHash: string | null = null;
  let extractionMethod: string | null = null;
  let success = false;

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
    fileSizeBytes = pdfBuffer.length;
    const stem = safeBaseName(fileName);
    const displayName = displayNameInput || stem;
    const documentType = documentTypeRaw as PdfDocumentType;
    pdfHash = md5HexPdf(pdfBuffer);

    const schema = await extractSchemaFromPdf(pdfBuffer, fileName);
    extractionMethod = String(schema['x-extraction-method'] || 'unknown');

    const entry = await savePracticePdfTemplate({
      token,
      fileName,
      pdfBuffer,
      pdfHash,
      schema,
      documentType,
      displayName,
    });

    success = true;
    res.json({ template: entry });
  } catch (err) {
    console.error('[pdf-filler] upload template:', err);
    const message = err instanceof Error ? err.message : 'Upload failed.';
    if (message.includes('extract-schema failed')) {
      res.status(502).json({ error: 'PDF analysis service unavailable or failed.', detail: message });
      return;
    }
    res.status(500).json({ error: 'Failed to save PDF template.', detail: message });
  } finally {
    if (fileSizeBytes > 0) {
      void insertPdfExtractionTelemetry({
        pdf_hash: pdfHash,
        file_size_bytes: fileSizeBytes,
        duration_ms: performance.now() - startedAt,
        cache_hit: false,
        extraction_method: extractionMethod,
        flow: 'template_upload',
        success,
      });
    }
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

class TemplateNotFoundError extends Error {
  constructor() {
    super('TEMPLATE_NOT_FOUND');
    this.name = 'TemplateNotFoundError';
  }
}

async function resolveTemplateEntry(token: string, templateId: string) {
  const folderId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
  const { manifest } = await loadPdfTemplatesManifest(token, folderId);
  const entry = findTemplateEntry(manifest, templateId);
  if (!entry) throw new TemplateNotFoundError();
  return entry;
}

async function loadTemplateSchema(
  token: string,
  templateId: string
): Promise<Record<string, unknown>> {
  const entry = await resolveTemplateEntry(token, templateId);
  const schemaBuffer = await downloadFileBuffer(token, entry.schemaDriveFileId);
  return JSON.parse(schemaBuffer.toString('utf-8')) as Record<string, unknown>;
}

async function loadTemplatePdfAndSchema(
  token: string,
  templateId: string
): Promise<{
  entry: NonNullable<ReturnType<typeof findTemplateEntry>>;
  pdfBuffer: Buffer;
  schema: Record<string, unknown>;
}> {
  const entry = await resolveTemplateEntry(token, templateId);
  const [pdfBuffer, schemaBuffer] = await Promise.all([
    downloadFileBuffer(token, entry.pdfDriveFileId),
    downloadFileBuffer(token, entry.schemaDriveFileId),
  ]);
  const schema = JSON.parse(schemaBuffer.toString('utf-8')) as Record<string, unknown>;
  return { entry, pdfBuffer, schema };
}

function isSidecarRouteMissing(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes('(404)') || err.message.includes('"Not Found"'))
  );
}

async function autofillFieldValues(
  markdown: string,
  schemaFields: ReturnType<typeof schemaPropertiesToFields>,
  patientFolderId: string
): Promise<Record<string, string | null>> {
  try {
    return await autofillFromPatientSummary(markdown, schemaFields, patientFolderId);
  } catch (err) {
    if (!isSidecarRouteMissing(err)) throw err;
    console.warn(
      '[pdf-filler] Sidecar /api/autofill not available — using Genesis Gemini autofill'
    );
    return extractDataFromPatientSummary(schemaFields, markdown);
  }
}

router.post('/patients/:patientId/autofill', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const patientFolderId = String(req.params.patientId);
    const templateId = sanitizeString(req.body.templateId, 64);

    if (!templateId) {
      res.status(400).json({ error: 'templateId is required.' });
      return;
    }

    let schema: Record<string, unknown>;
    try {
      schema = await loadTemplateSchema(token, templateId);
    } catch (e) {
      if (e instanceof TemplateNotFoundError) {
        res.status(404).json({ error: 'Template not found.' });
        return;
      }
      throw e;
    }

    const { markdown } = await ensurePatientSummaryUpToDate(token, patientFolderId);
    const schemaFields = schemaPropertiesToFields(schema);
    const values = await autofillFieldValues(markdown, schemaFields, patientFolderId);

    res.json({ values });
  } catch (err) {
    console.error('[pdf-filler] autofill:', err);
    const message = err instanceof Error ? err.message : 'Autofill failed.';
    res.status(500).json({ error: 'Failed to autofill from patient summary.', detail: message });
  }
});

router.post('/patients/:patientId/fill', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const patientFolderId = String(req.params.patientId);
    const templateId = sanitizeString(req.body.templateId, 64);
    const answers = req.body.answers as Record<string, unknown> | undefined;
    const newlyAddedData = req.body.newlyAddedData as Record<string, unknown> | undefined;

    if (!templateId) {
      res.status(400).json({ error: 'templateId is required.' });
      return;
    }
    if (!answers || typeof answers !== 'object') {
      res.status(400).json({ error: 'answers object is required.' });
      return;
    }

    let entry;
    let pdfBuffer: Buffer;
    let schema: Record<string, unknown>;
    try {
      ({ entry, pdfBuffer, schema } = await loadTemplatePdfAndSchema(token, templateId));
    } catch (e) {
      if (e instanceof TemplateNotFoundError) {
        res.status(404).json({ error: 'Template not found.' });
        return;
      }
      throw e;
    }

    const schemaFields = schemaPropertiesToFields(schema);
    const hasNewData =
      newlyAddedData &&
      typeof newlyAddedData === 'object' &&
      Object.keys(newlyAddedData).length > 0;

    let summaryFieldsUpdated = 0;
    if (hasNewData) {
      const enrichResult = await enrichPatientSummaryFromFormSubmission(token, patientFolderId, {
        templateId,
        templateDisplayName: entry.displayName,
        newlyAddedData,
        schemaFields,
      });
      summaryFieldsUpdated = enrichResult.fieldsWritten;
    }

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
      summaryFieldsUpdated,
    });
  } catch (err) {
    console.error('[pdf-filler] fill:', err);
    const message = err instanceof Error ? err.message : 'Fill failed.';
    res.status(500).json({ error: 'Failed to generate filled PDF.', detail: message });
  }
});

export default router;
