import { Router, Request, Response } from 'express';
import { config } from '../config';
import { requireAuth } from '../middleware/requireAuth';
import {
  downloadFileBuffer,
  getOrCreatePatientSubfolder,
  getOrCreatePracticeAdminPdfDocumentsFolder,
  uploadToDrive,
} from '../services/drive';
import { sanitizeString } from '../services/drive';
import {
  handleExtractionRequest,
  handleExtractionJobRequest,
  handleExtractionJobStatus,
  handleFillRequest,
  handleApproveMapping,
  handlePublishPracticeTemplate,
  handleSaveTemplate,
} from '../controllers/pdfFillerController';
import { md5HexPdf, isValidPdfHash } from '../services/pdfHash';
import { extractDataFromPatientSummary } from '../services/pdfFillerAutofill';
import { GEMINI_TIMEOUT_MS } from '../services/gemini';
import {
  extractSchemaFromPdf,
  fillPdfViaSidecar,
  pdfFillerHealthCheck,
} from '../services/pdfFillerClient';
import {
  enrichPatientSummaryFromFormSubmission,
  readExistingPatientSummaryMarkdown,
  readExistingPatientSummaryState,
  triggerPatientSummarySync,
} from '../services/patientSummary';
import { fieldsNeedingLlm, prefillFromSummaryState } from '../services/pdfSummaryPrefill';
import { schemaPropertiesToFields, schemaFieldsForSummaryAutofill } from '../utils/pdfSchemaUtils';
import { resolveClinicianProfile } from '../services/clinicianProfile';
import { savePracticePdfTemplate, updatePracticePdfTemplateMetadata, importSharedFormSchemaToPractice } from '../services/practicePdfTemplateStore';
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
import type { SignatureOptions } from '../../shared/documentSignatures';
import {
  applySignatureToPdf,
  resolveDocumentSignature,
  signatureAppProperties,
} from '../services/documentSignatureService';
import { validateInsuranceCompanyForDocumentType } from '../../shared/insuranceCompanies';
import {
  inferTemplateMetadataFromPdf,
  mergeTemplateMetadata,
} from '../services/pdfTemplateMetadataInference';
import { registerTemplateSharing } from '../services/registerTemplateSharing';
import { getGlobalSchemaByHash } from '../services/formTemplateCache';
import {
  incrementSharedFormImportCount,
  listPublicCatalogForPack,
  listPublicSharedFormCatalog,
} from '../services/sharedFormCatalogStore';
import { requireAnyPersona, requireAdminStaffPersona } from '../middleware/requirePersona';
import { createJob, getJob, updateJob, type StoredJob } from '../services/jobStore';
import { isConsultant } from '../services/userStore';

const router = Router();
router.use(requireAuth);

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
/** Matches sidecar autofill budget: one Gemini window plus HTTP slack. */
const AUTOFILL_RESPONSE_TIMEOUT_MS = GEMINI_TIMEOUT_MS + 30_000;
const AUTOFILL_TIMEOUT_MESSAGE = 'PDF_FILLER_AUTOFILL_TIMEOUT';

type PdfAutofillPendingReason = 'summary_building' | 'autofill_slow';
const TEMPLATE_CACHE_TTL_MS = 10 * 60 * 1000;

type PdfFillSaveInput = {
  patientFolderId: string;
  templateId: string;
  answers: Record<string, unknown>;
  newlyAddedData?: Record<string, unknown>;
  signatureOptions?: SignatureOptions;
};

type PdfFillSaveResult = {
  fileId: string;
  name: string;
  subfolder: string;
  templateId: string;
  summaryFieldsUpdated?: number;
  summaryPending?: boolean;
  summaryWarning?: string;
  timingsMs?: Record<string, number>;
};

type PdfFillSaveActor = {
  email: string;
  name: string;
};

type PdfFillSaveProgress = (phase: string, progress: number, message: string) => void | Promise<void>;

type LoadedPdfTemplate = {
  entry: NonNullable<ReturnType<typeof findTemplateEntry>>;
  pdfBuffer: Buffer;
  schema: Record<string, unknown>;
};

const templateCache = new Map<string, { loadedAt: number; template: LoadedPdfTemplate }>();

type CachedTemplateSchema = {
  loadedAt: number;
  schemaDriveFileId: string;
  schema: Record<string, unknown>;
};
const templateSchemaCache = new Map<string, CachedTemplateSchema>();

function invalidateTemplateCaches(templateId: string): void {
  templateSchemaCache.delete(templateId);
  templateCache.delete(templateId);
}

function safeBaseName(fileName: string): string {
  const base = fileName.replace(/\.pdf$/i, '').trim() || 'template';
  return base.replace(/[^\w\s.-]/g, '_').slice(0, 120);
}

function getPdfFillActor(req: Request): PdfFillSaveActor {
  const name =
    (typeof req.session.userName === 'string' && req.session.userName.trim()) ||
    req.session.userEmail ||
    'Unknown';
  return {
    email: req.session.userEmail || 'unknown',
    name,
  };
}

function validatePdfFillSaveInput(
  patientFolderId: string,
  body: Record<string, unknown>
): PdfFillSaveInput {
  const templateId = sanitizeString(body.templateId, 64);
  const answers = body.answers as Record<string, unknown> | undefined;
  const newlyAddedData = body.newlyAddedData as Record<string, unknown> | undefined;
  const signatureOptions = body.signatureOptions as SignatureOptions | undefined;

  if (!templateId) {
    throw Object.assign(new Error('templateId is required.'), { status: 400 });
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    throw Object.assign(new Error('answers object is required.'), { status: 400 });
  }

  return {
    patientFolderId,
    templateId,
    answers,
    newlyAddedData,
    signatureOptions,
  };
}

function createPhaseTimer(label: string): {
  timings: Record<string, number>;
  time<T>(phase: string, work: () => Promise<T> | T): Promise<T>;
  log(): void;
} {
  const timings: Record<string, number> = {};
  const startedAt = performance.now();
  return {
    timings,
    async time<T>(phase: string, work: () => Promise<T> | T): Promise<T> {
      const phaseStartedAt = performance.now();
      try {
        return await work();
      } finally {
        timings[phase] = Math.round(performance.now() - phaseStartedAt);
      }
    },
    log() {
      timings.total = Math.round(performance.now() - startedAt);
      console.info(`[pdf-filler] ${label} timings:`, timings);
    },
  };
}

function serializePdfFillJob(job: StoredJob<unknown, PdfFillSaveResult>) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

function canViewPdfFillJob(req: Request, job: StoredJob): boolean {
  const email = req.session.userEmail || '';
  return job.actor.email === email || isConsultant(email);
}

router.get('/extract/estimate', requireAdminStaffPersona, async (req: Request, res: Response) => {
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

router.post('/extract', requireAdminStaffPersona, (req, res) => void handleExtractionRequest(req, res));
router.post('/extract/jobs', requireAdminStaffPersona, (req, res) => void handleExtractionJobRequest(req, res));
router.get('/extract/jobs/:jobId', requireAdminStaffPersona, (req, res) => handleExtractionJobStatus(req, res));
router.post('/approve-mapping', requireAdminStaffPersona, (req, res) => void handleApproveMapping(req, res));
router.post('/schema/global', requireAdminStaffPersona, (req, res) => void handleSaveTemplate(req, res));
router.post('/templates/publish', requireAdminStaffPersona, (req, res) => void handlePublishPracticeTemplate(req, res));
router.post('/fill', requireAnyPersona, (req, res) => void handleFillRequest(req, res));

router.get('/health', async (_req: Request, res: Response) => {
  const sidecarOk = await pdfFillerHealthCheck();
  res.status(sidecarOk ? 200 : 503).json({
    ok: sidecarOk,
    sidecarUrl: config.pdfFillerServiceUrl,
  });
});

router.get('/clinician-profile', requireAnyPersona, (req: Request, res: Response) => {
  const profile = resolveClinicianProfile(req);
  if (!profile) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  res.json({ profile });
});

router.get('/templates', requireAnyPersona, async (req: Request, res: Response) => {
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

router.get('/templates/:templateId/schema', requireAnyPersona, async (req: Request, res: Response) => {
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

router.get('/templates/:templateId/pdf', requireAnyPersona, async (req: Request, res: Response) => {
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
    if (entry.pdfPending || !entry.pdfDriveFileId) {
      res.status(409).json({ error: 'Blank PDF not attached yet.', pdfPending: true });
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

router.post('/templates', requireAdminStaffPersona, async (req: Request, res: Response) => {
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
    const insuranceCompanyIdRaw = sanitizeString(req.body.insuranceCompanyId, 64);
    const keepPrivate = Boolean(req.body.keepPrivate);

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
    pdfHash = md5HexPdf(pdfBuffer);

    const schema = await extractSchemaFromPdf(pdfBuffer, fileName);
    extractionMethod = String(schema['x-extraction-method'] || 'unknown');

    const inferred = await inferTemplateMetadataFromPdf(pdfBuffer, fileName);
    const merged = mergeTemplateMetadata({
      fileName,
      displayNameInput,
      documentTypeInput: documentTypeRaw as PdfDocumentType,
      insuranceCompanyIdInput: insuranceCompanyIdRaw || undefined,
      inferred,
    });

    const insuranceErr = validateInsuranceCompanyForDocumentType(
      merged.documentType,
      merged.insuranceCompanyId
    );
    if (insuranceErr) {
      res.status(400).json({ error: insuranceErr });
      return;
    }

    const entry = await savePracticePdfTemplate({
      token,
      fileName,
      pdfBuffer,
      pdfHash,
      schema,
      documentType: merged.documentType,
      displayName: merged.displayName,
      insuranceCompanyId: merged.insuranceCompanyId,
    });

    await registerTemplateSharing(req, {
      pdfHash,
      schema,
      entry,
      keepPrivate,
    });

    success = true;
    invalidateTemplateCaches(entry.templateId);
    res.json({ template: entry, inferredMetadata: merged.inferred });
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

router.patch('/templates/:templateId', requireAdminStaffPersona, async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const templateId = String(req.params.templateId);
    const displayName = sanitizeString(req.body.displayName, 255);
    const documentTypeRaw = sanitizeString(req.body.documentType, 64);
    const insuranceCompanyIdRaw = sanitizeString(req.body.insuranceCompanyId, 64);

    if (!displayName) {
      res.status(400).json({ error: 'displayName is required.' });
      return;
    }
    if (!isPdfDocumentType(documentTypeRaw)) {
      res.status(400).json({ error: 'Invalid document type.' });
      return;
    }
    const insuranceErr = validateInsuranceCompanyForDocumentType(
      documentTypeRaw,
      insuranceCompanyIdRaw || undefined
    );
    if (insuranceErr) {
      res.status(400).json({ error: insuranceErr });
      return;
    }

    const documentType = documentTypeRaw as PdfDocumentType;
    const insuranceCompanyId =
      documentType === 'insurance_form' ? insuranceCompanyIdRaw || undefined : undefined;

    const template = await updatePracticePdfTemplateMetadata({
      token,
      templateId,
      displayName,
      documentType,
      insuranceCompanyId,
    });
    res.json({ template });
  } catch (err) {
    if (err instanceof Error && err.message === 'TEMPLATE_NOT_FOUND') {
      res.status(404).json({ error: 'Template not found.' });
      return;
    }
    console.error('[pdf-filler] patch template:', err);
    res.status(500).json({ error: 'Failed to update template.' });
  }
});

router.delete('/templates/:templateId', requireAdminStaffPersona, async (req: Request, res: Response) => {
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

async function loadTemplateSchemaCached(
  token: string,
  templateId: string
): Promise<Record<string, unknown>> {
  const entry = await resolveTemplateEntry(token, templateId);
  const cached = templateSchemaCache.get(templateId);
  if (
    cached &&
    Date.now() - cached.loadedAt < TEMPLATE_CACHE_TTL_MS &&
    cached.schemaDriveFileId === entry.schemaDriveFileId
  ) {
    return cached.schema;
  }
  const schemaBuffer = await downloadFileBuffer(token, entry.schemaDriveFileId);
  const schema = JSON.parse(schemaBuffer.toString('utf-8')) as Record<string, unknown>;
  templateSchemaCache.set(templateId, {
    loadedAt: Date.now(),
    schemaDriveFileId: entry.schemaDriveFileId,
    schema,
  });
  return schema;
}

async function loadTemplateSchema(
  token: string,
  templateId: string
): Promise<Record<string, unknown>> {
  return loadTemplateSchemaCached(token, templateId);
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
  if (entry.pdfPending || !entry.pdfDriveFileId) {
    throw new Error('PDF_PENDING');
  }
  const [pdfBuffer, schemaBuffer] = await Promise.all([
    downloadFileBuffer(token, entry.pdfDriveFileId),
    downloadFileBuffer(token, entry.schemaDriveFileId),
  ]);
  const schema = JSON.parse(schemaBuffer.toString('utf-8')) as Record<string, unknown>;
  return { entry, pdfBuffer, schema };
}

async function loadTemplatePdfAndSchemaCached(
  token: string,
  templateId: string
): Promise<LoadedPdfTemplate> {
  const entry = await resolveTemplateEntry(token, templateId);
  const cached = templateCache.get(templateId);
  if (
    cached &&
    Date.now() - cached.loadedAt < TEMPLATE_CACHE_TTL_MS &&
    cached.template.entry.schemaDriveFileId === entry.schemaDriveFileId &&
    cached.template.entry.pdfDriveFileId === entry.pdfDriveFileId
  ) {
    return cached.template;
  }

  const template = await loadTemplatePdfAndSchema(token, templateId);
  templateCache.set(templateId, { loadedAt: Date.now(), template });
  templateSchemaCache.set(templateId, {
    loadedAt: Date.now(),
    schemaDriveFileId: template.entry.schemaDriveFileId,
    schema: template.schema,
  });
  return template;
}

function startSummaryEnrichment(params: {
  token: string;
  patientFolderId: string;
  templateId: string;
  templateDisplayName: string;
  newlyAddedData: Record<string, unknown>;
  schemaFields: ReturnType<typeof schemaPropertiesToFields>;
  onComplete?: (fieldsWritten: number) => void;
  onError?: (message: string) => void;
}): void {
  void (async () => {
    try {
      const enrichResult = await enrichPatientSummaryFromFormSubmission(params.token, params.patientFolderId, {
        templateId: params.templateId,
        templateDisplayName: params.templateDisplayName,
        newlyAddedData: params.newlyAddedData,
        schemaFields: params.schemaFields,
      });
      params.onComplete?.(enrichResult.fieldsWritten);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Summary enrichment failed.';
      console.error('[pdf-filler] background summary enrichment failed:', err);
      params.onError?.(message);
    }
  })();
}

async function performPatientPdfFillSave(params: {
  token: string;
  input: PdfFillSaveInput;
  actor: PdfFillSaveActor;
  onProgress?: PdfFillSaveProgress;
  waitForSummary?: boolean;
}): Promise<PdfFillSaveResult> {
  const { token, input, actor, onProgress, waitForSummary = false } = params;
  const timer = createPhaseTimer(`fill ${input.templateId}`);
  let result: PdfFillSaveResult | null = null;

  try {
    await onProgress?.('loading_template', 10, 'Loading form template.');
    let loaded: LoadedPdfTemplate;
    try {
      loaded = await timer.time('load_template', () =>
        loadTemplatePdfAndSchemaCached(token, input.templateId)
      );
    } catch (e) {
      if (e instanceof TemplateNotFoundError) {
        throw Object.assign(new Error('Template not found.'), { status: 404 });
      }
      throw e;
    }

    const { entry, pdfBuffer, schema } = loaded;
    const schemaFields = schemaPropertiesToFields(schema);
    const hasNewData =
      input.newlyAddedData &&
      typeof input.newlyAddedData === 'object' &&
      Object.keys(input.newlyAddedData).length > 0;

    await onProgress?.('filling_pdf', 30, 'Filling PDF.');
    const [filledPdf, signature, targetFolderId] = await timer.time('fill_prepare_parallel', () =>
      Promise.all([
        fillPdfViaSidecar(pdfBuffer, schema, input.answers),
        resolveDocumentSignature({
          token,
          email: actor.email,
          actorName: actor.name,
          policyKey: 'pdf_filler',
          options: input.signatureOptions,
        }),
        getOrCreatePatientSubfolder(
          token,
          input.patientFolderId,
          PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER[entry.documentType]
        ),
      ])
    );

    await onProgress?.('signing', 55, 'Applying signature settings.');
    const signedPdf = await timer.time('apply_signature', () => applySignatureToPdf(filledPdf, signature));

    const subfolderName = PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER[entry.documentType];
    const outName = `${entry.displayName} — filled ${new Date().toISOString().slice(0, 10)}.pdf`;

    await onProgress?.('uploading_drive', 75, 'Saving PDF to Google Drive.');
    const fileId = await timer.time('upload_drive', () =>
      uploadToDrive(
        token,
        outName,
        'application/pdf',
        targetFolderId,
        signedPdf,
        {
          halo_pdf_filled: '1',
          template_id: input.templateId,
          ...signatureAppProperties(signature),
        }
      )
    );

    result = {
      fileId,
      name: outName,
      subfolder: subfolderName,
      templateId: input.templateId,
      summaryPending: Boolean(hasNewData),
    };

    if (hasNewData && input.newlyAddedData) {
      const runSummary = async () => {
        await onProgress?.('updating_summary', 92, 'Updating patient summary.');
        const enrichResult = await timer.time('summary_enrichment', () =>
          enrichPatientSummaryFromFormSubmission(token, input.patientFolderId, {
            templateId: input.templateId,
            templateDisplayName: entry.displayName,
            newlyAddedData: input.newlyAddedData!,
            schemaFields,
          })
        );
        result!.summaryFieldsUpdated = enrichResult.fieldsWritten;
        result!.summaryPending = false;
      };

      if (waitForSummary) {
        try {
          await runSummary();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Summary enrichment failed.';
          console.error('[pdf-filler] summary enrichment failed:', err);
          result.summaryWarning = 'Document saved, but the patient summary could not be updated.';
          result.summaryPending = false;
          result.timingsMs = { ...timer.timings };
          result.timingsMs.summary_error = 1;
          result.summaryFieldsUpdated = 0;
          result.summaryWarning = message;
        }
      } else {
        startSummaryEnrichment({
          token,
          patientFolderId: input.patientFolderId,
          templateId: input.templateId,
          templateDisplayName: entry.displayName,
          newlyAddedData: input.newlyAddedData,
          schemaFields,
          onComplete: (fieldsWritten) => {
            console.info(
              `[pdf-filler] background summary enrichment complete for ${input.patientFolderId}: ${fieldsWritten} fields`
            );
          },
        });
      }
    }

    await onProgress?.('complete', 100, 'PDF saved.');
    return result;
  } finally {
    timer.log();
    if (result) {
      result.timingsMs = { ...timer.timings };
    }
  }
}

function startPatientPdfFillJob(job: StoredJob<PdfFillSaveInput>, token: string): void {
  void (async () => {
    try {
      updateJob(job.id, {
        status: 'running',
        phase: 'starting',
        progress: 5,
        message: 'Starting PDF save.',
      });

      const result = await performPatientPdfFillSave({
        token,
        input: job.input,
        actor: job.actor,
        waitForSummary: false,
        onProgress: (phase, progress, message) => {
          updateJob(job.id, {
            status: 'running',
            phase,
            progress,
            message,
          });
        },
      });

      updateJob<PdfFillSaveResult>(job.id, {
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        message: result.summaryPending
          ? 'PDF saved. Patient summary is updating in the background.'
          : 'PDF saved.',
        result,
        error: result.summaryWarning || null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF save failed.';
      console.error('[pdf-filler/fill/job] error:', err);
      updateJob(job.id, {
        status: 'failed',
        phase: 'failed',
        progress: 100,
        message,
        error: message,
      });
    }
  })();
}

function emptyAutofillValues(
  schemaFields: ReturnType<typeof schemaPropertiesToFields>
): Record<string, string | null> {
  const values: Record<string, string | null> = {};
  for (const field of schemaFields) {
    if (field.id) values[field.id] = null;
  }
  return values;
}

async function withAutofillResponseTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(AUTOFILL_TIMEOUT_MESSAGE)),
          AUTOFILL_RESPONSE_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

router.post('/patients/:patientId/autofill', requireAnyPersona, async (req: Request, res: Response) => {
  let schemaFields: ReturnType<typeof schemaPropertiesToFields> = [];
  try {
    const token = req.session.accessToken!;
    const patientFolderId = String(req.params.patientId);
    const templateId = sanitizeString(req.body.templateId, 64);

    if (!templateId) {
      res.status(400).json({ error: 'templateId is required.' });
      return;
    }

    let loadSchemaMs = 0;
    let readSummaryMs = 0;

    const schemaPromise = (async () => {
      const t0 = performance.now();
      const s = await loadTemplateSchemaCached(token, templateId);
      loadSchemaMs = Math.round(performance.now() - t0);
      return s;
    })();

    const summaryPromise = (async () => {
      const t0 = performance.now();
      const [state, markdown] = await Promise.all([
        readExistingPatientSummaryState(token, patientFolderId),
        readExistingPatientSummaryMarkdown(token, patientFolderId),
      ]);
      readSummaryMs = Math.round(performance.now() - t0);
      return { state, markdown };
    })();

    let schema: Record<string, unknown>;
    let summaryBundle: { state: Awaited<ReturnType<typeof readExistingPatientSummaryState>>; markdown: string | null };
    try {
      [schema, summaryBundle] = await Promise.all([schemaPromise, summaryPromise]);
    } catch (e) {
      if (e instanceof TemplateNotFoundError) {
        res.status(404).json({ error: 'Template not found.' });
        return;
      }
      throw e;
    }

    schemaFields = schemaFieldsForSummaryAutofill(schema);
    const { state: summaryState, markdown } = summaryBundle;

    if (!summaryState && !markdown) {
      triggerPatientSummarySync(token, patientFolderId, 'autofill');
      res.status(202).json({
        values: emptyAutofillValues(schemaFields),
        summaryPending: true,
        pendingReason: 'summary_building' as PdfAutofillPendingReason,
        message: 'Patient summary is still building. Try autofill again in a minute.',
      });
      return;
    }

    if (!summaryState) {
      triggerPatientSummarySync(token, patientFolderId, 'autofill');
      res.status(202).json({
        values: emptyAutofillValues(schemaFields),
        summaryPending: true,
        pendingReason: 'summary_building' as PdfAutofillPendingReason,
        message: 'Summary state is building. Try autofill again shortly.',
      });
      return;
    }

    const ruleT0 = performance.now();
    const ruleValues = prefillFromSummaryState(schemaFields, summaryState);
    const rulePrefillMs = Math.round(performance.now() - ruleT0);

    const llmFields = fieldsNeedingLlm(schemaFields, ruleValues);
    let llmValues: Record<string, string | null> = {};
    let geminiMs = 0;

    if (llmFields.length > 0) {
      const geminiT0 = performance.now();
      llmValues = await withAutofillResponseTimeout(
        extractDataFromPatientSummary(llmFields, summaryState)
      );
      geminiMs = Math.round(performance.now() - geminiT0);
    }

    const values = { ...emptyAutofillValues(schemaFields), ...ruleValues, ...llmValues };

    console.info(
      '[pdf-filler/autofill]',
      JSON.stringify({
        load_schema_ms: loadSchemaMs,
        read_summary_ms: readSummaryMs,
        rule_prefill_ms: rulePrefillMs,
        gemini_ms: geminiMs,
        field_count: schemaFields.length,
        llm_field_count: llmFields.length,
      })
    );

    const payload: Record<string, unknown> = { values };
    if (!config.isProduction) {
      payload.timingsMs = {
        load_schema_ms: loadSchemaMs,
        read_summary_ms: readSummaryMs,
        rule_prefill_ms: rulePrefillMs,
        gemini_ms: geminiMs,
        field_count: schemaFields.length,
        llm_field_count: llmFields.length,
      };
    }

    res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Autofill failed.';
    if (message === AUTOFILL_TIMEOUT_MESSAGE) {
      res.status(202).json({
        values: emptyAutofillValues(schemaFields),
        summaryPending: true,
        pendingReason: 'autofill_slow' as PdfAutofillPendingReason,
        message:
          'Autofill is taking longer than expected. Wait a moment, then try once more.',
      });
      return;
    }
    console.error('[pdf-filler] autofill:', err);
    res.status(500).json({ error: 'Failed to autofill from patient summary.', detail: message });
  }
});

router.post('/patients/:patientId/fill', requireAnyPersona, async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const patientFolderId = String(req.params.patientId);
    const input = validatePdfFillSaveInput(patientFolderId, req.body as Record<string, unknown>);
    const result = await performPatientPdfFillSave({
      token,
      input,
      actor: getPdfFillActor(req),
      waitForSummary: false,
    });
    res.json(config.isProduction ? { ...result, timingsMs: undefined } : result);
  } catch (err) {
    console.error('[pdf-filler] fill:', err);
    const message = err instanceof Error ? err.message : 'Fill failed.';
    const status = err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
      ? err.status
      : 500;
    res.status(status).json({ error: 'Failed to generate filled PDF.', detail: message });
  }
});

router.post('/patients/:patientId/fill/jobs', requireAnyPersona, async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const patientFolderId = String(req.params.patientId);
    const input = validatePdfFillSaveInput(patientFolderId, req.body as Record<string, unknown>);
    const job = createJob<PdfFillSaveInput>('pdf-filler.fill', input, getPdfFillActor(req));

    startPatientPdfFillJob(job, token);

    res.status(202).json({
      jobId: job.id,
      job: serializePdfFillJob(job as StoredJob<unknown, PdfFillSaveResult>),
    });
  } catch (err) {
    console.error('[pdf-filler] fill job:', err);
    const message = err instanceof Error ? err.message : 'Could not start PDF save job.';
    const status = err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
      ? err.status
      : 500;
    res.status(status).json({ error: message });
  }
});

router.get('/jobs/:jobId', requireAnyPersona, (req: Request, res: Response): void => {
  const job = getJob<unknown, PdfFillSaveResult>(String(req.params.jobId));
  if (!job || job.type !== 'pdf-filler.fill') {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  if (!canViewPdfFillJob(req, job)) {
    res.status(403).json({ error: 'You do not have access to this job.' });
    return;
  }
  res.json({ job: serializePdfFillJob(job) });
});

router.get('/shared-forms/catalog', requireAdminStaffPersona, async (req: Request, res: Response) => {
  try {
    const documentTypeRaw = sanitizeString(String(req.query.documentType || ''), 64);
    const insuranceCompanyId = sanitizeString(String(req.query.insuranceCompanyId || ''), 64);

    const filters: { documentType?: PdfDocumentType; insuranceCompanyId?: string } = {};
    if (documentTypeRaw && isPdfDocumentType(documentTypeRaw)) {
      filters.documentType = documentTypeRaw;
    }
    if (insuranceCompanyId) filters.insuranceCompanyId = insuranceCompanyId;

    const entries = await listPublicSharedFormCatalog(filters);
    res.json({ entries });
  } catch (err) {
    console.error('[pdf-filler] shared catalog:', err);
    res.status(500).json({ error: 'Failed to load shared forms catalog.' });
  }
});

router.post('/shared-forms/:pdfHash/import', requireAdminStaffPersona, async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const pdfHash = sanitizeString(req.params.pdfHash, 64).toLowerCase();
    if (!isValidPdfHash(pdfHash)) {
      res.status(400).json({ error: 'Invalid pdfHash.' });
      return;
    }

    const cached = await getGlobalSchemaByHash(pdfHash);
    if (!cached) {
      res.status(502).json({ error: 'Shared form schema not available yet.' });
      return;
    }

    const catalog = await listPublicSharedFormCatalog({});
    const meta = catalog.find((e) => e.pdf_hash === pdfHash);
    if (!meta) {
      res.status(404).json({ error: 'Shared form not found or is private.' });
      return;
    }

    const template = await importSharedFormSchemaToPractice({
      token,
      pdfHash,
      schema: cached.schema_json,
      documentType: meta.document_type,
      displayName: meta.display_name,
      insuranceCompanyId: meta.insurance_company_id ?? undefined,
    });

    void incrementSharedFormImportCount(pdfHash);
    invalidateTemplateCaches(template.templateId);
    res.json({ template, pdfPending: true });
  } catch (err) {
    console.error('[pdf-filler] shared import:', err);
    res.status(500).json({ error: 'Failed to import shared form.' });
  }
});

router.post('/shared-forms/import-pack', requireAdminStaffPersona, async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const documentTypeRaw = sanitizeString(req.body.documentType, 64);
    const insuranceCompanyId = sanitizeString(req.body.insuranceCompanyId, 64);

    if (!isPdfDocumentType(documentTypeRaw) || documentTypeRaw !== 'insurance_form') {
      res.status(400).json({ error: 'Pack import requires documentType insurance_form.' });
      return;
    }
    if (!insuranceCompanyId) {
      res.status(400).json({ error: 'insuranceCompanyId is required.' });
      return;
    }

    const pack = await listPublicCatalogForPack(documentTypeRaw, insuranceCompanyId);
    const imported: string[] = [];
    for (const item of pack) {
      const cached = await getGlobalSchemaByHash(item.pdf_hash);
      if (!cached) continue;
      await importSharedFormSchemaToPractice({
        token,
        pdfHash: item.pdf_hash,
        schema: cached.schema_json,
        documentType: item.document_type,
        displayName: item.display_name,
        insuranceCompanyId: item.insurance_company_id ?? undefined,
      });
      void incrementSharedFormImportCount(item.pdf_hash);
      imported.push(item.pdf_hash);
    }

    res.json({ importedCount: imported.length, pdfHashes: imported });
  } catch (err) {
    console.error('[pdf-filler] shared import pack:', err);
    res.status(500).json({ error: 'Failed to import shared form pack.' });
  }
});

router.post('/shared-forms/:pdfHash/attach', requireAdminStaffPersona, async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const pdfHash = sanitizeString(req.params.pdfHash, 64).toLowerCase();
    const fileName = sanitizeString(req.body.fileName, 255);
    const fileData = req.body.fileData as string;

    if (!isValidPdfHash(pdfHash) || !fileData) {
      res.status(400).json({ error: 'pdfHash and fileData are required.' });
      return;
    }

    const pdfBuffer = Buffer.from(fileData, 'base64');
    if (md5HexPdf(pdfBuffer) !== pdfHash) {
      res.status(400).json({ error: 'PDF does not match expected form fingerprint.' });
      return;
    }

    const folderId = await getOrCreatePracticeAdminPdfDocumentsFolder(token);
    const { manifest } = await loadPdfTemplatesManifest(token, folderId);
    const entry = manifest.templates.find((t) => t.pdfHash === pdfHash);
    if (!entry) {
      res.status(404).json({ error: 'Import this form to your library first.' });
      return;
    }

    const schemaBuffer = await downloadFileBuffer(token, entry.schemaDriveFileId);
    const schema = JSON.parse(schemaBuffer.toString('utf-8')) as Record<string, unknown>;
    const safeName = `${entry.displayName.replace(/[^\w\s.-]+/g, '_').trim() || 'form'}.pdf`;

    const template = await savePracticePdfTemplate({
      token,
      fileName: fileName?.endsWith('.pdf') ? fileName : safeName,
      pdfBuffer,
      pdfHash,
      schema,
      documentType: entry.documentType,
      displayName: entry.displayName,
      templateId: entry.templateId,
      insuranceCompanyId: entry.insuranceCompanyId,
    });

    invalidateTemplateCaches(template.templateId);
    res.json({ template });
  } catch (err) {
    console.error('[pdf-filler] shared attach:', err);
    res.status(500).json({ error: 'Failed to attach PDF.' });
  }
});

export default router;
