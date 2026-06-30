import { Request, Response } from 'express';
import { isPdfDocumentType } from '../../shared/pdfFiller';
import { validateInsuranceCompanyForDocumentType } from '../../shared/insuranceCompanies';
import { sanitizeString } from '../services/drive';
import { savePracticePdfTemplate } from '../services/practicePdfTemplateStore';
import {
  extractSchemaFromPdf,
  fillPdfViaSidecarResponse,
} from '../services/pdfFillerClient';
import {
  inferTemplateMetadataFromPdf,
  mergeTemplateMetadata,
} from '../services/pdfTemplateMetadataInference';
import { registerTemplateSharing } from '../services/registerTemplateSharing';
import {
  getGlobalSchemaByHash,
  isFormTemplateCacheConfigured,
  upsertGlobalSchema,
} from '../services/formTemplateCache';
import { isValidPdfHash, isValidPdfSha256, md5HexPdf, sha256HexPdf } from '../services/pdfHash';
import type { MappingFeedbackRequest, ValidatedMappingField } from '../../shared/mappingFeedback';
import { SHA256_HEX_RE, UUID_RE } from '../../shared/mappingFeedback';
import {
  insertMappingApproval,
  isMappingCorrectionStoreConfigured,
} from '../services/mappingCorrectionStore';
import { decodeBase64Pdf, pipeWebStreamToExpress } from '../utils/streamUtils';
import { countSchemaProperties, prepareSidecarSchema } from '../utils/pdfSchemaUtils';
import { diffLayoutSchemas } from '../utils/schemaLayoutDiff';
import {
  insertLayoutCorrection,
  isFormLayoutCorrectionStoreConfigured,
} from '../services/formLayoutCorrectionStore';
import { insertPdfExtractionTelemetry } from '../services/pdfExtractionTelemetryStore';
import { createJob, getJob, updateJob, type StoredJob } from '../services/jobStore';

function schemaMeta(schema: Record<string, unknown>): {
  extractionMethod: string;
  schemaVersion: number;
} {
  return {
    extractionMethod: String(schema['x-extraction-method'] ?? 'unknown'),
    schemaVersion: Number(schema['x-schema-build-version'] ?? 1),
  };
}

type PdfExtractionJobInput = {
  fileName: string;
  pdfHash: string;
  pdfSha256: string;
  fileSizeBytes: number;
};

type PdfExtractionResult = {
  pdfHash: string;
  pdfSha256: string;
  schema: Record<string, unknown>;
  cacheHit: boolean;
  extractionMethod: string;
  schemaVersion: number;
};

function extractionActor(req: Request): StoredJob['actor'] {
  const email = req.session.userEmail || 'unknown';
  const name =
    (typeof req.session.userName === 'string' && req.session.userName.trim()) ||
    email ||
    'Unknown';
  return { email, name };
}

function serializeExtractionJob(job: StoredJob<unknown, PdfExtractionResult>) {
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

function canViewExtractionJob(req: Request, job: StoredJob): boolean {
  return job.actor.email === (req.session.userEmail || '');
}

async function loadCachedExtractionResult(
  pdfHash: string,
  pdfSha256: string
): Promise<PdfExtractionResult | null> {
  if (!isFormTemplateCacheConfigured()) return null;

  const cached = await getGlobalSchemaByHash(pdfHash);
  if (!cached) return null;

  const cachedSchema = prepareSidecarSchema(cached.schema_json as Record<string, unknown>);
  if (countSchemaProperties(cachedSchema) === 0) return null;

  return {
    pdfHash,
    pdfSha256,
    schema: cachedSchema,
    cacheHit: true,
    extractionMethod: cached.extraction_method,
    schemaVersion: cached.schema_version,
  };
}

async function extractPdfSchemaResult(
  pdfBuffer: Buffer,
  fileName: string,
  pdfHash: string,
  pdfSha256: string
): Promise<PdfExtractionResult> {
  const schema = prepareSidecarSchema(await extractSchemaFromPdf(pdfBuffer, fileName));
  if (countSchemaProperties(schema) === 0) {
    throw new Error(
      'No form fields were detected in this PDF. Try a clearer blank form, or re-run after the mapper service is updated.'
    );
  }

  const meta = schemaMeta(schema);
  if (isFormTemplateCacheConfigured()) {
    try {
      await upsertGlobalSchema({
        pdf_hash: pdfHash,
        schema_json: schema,
        extraction_method: meta.extractionMethod,
        schema_version: meta.schemaVersion,
      });
    } catch (cacheErr) {
      console.warn('[pdf-filler] cache upsert after extract (non-fatal):', cacheErr);
    }
  }

  return {
    pdfHash,
    pdfSha256,
    schema,
    cacheHit: false,
    extractionMethod: meta.extractionMethod,
    schemaVersion: meta.schemaVersion,
  };
}

function startExtractionJob(job: StoredJob<PdfExtractionJobInput>, pdfBuffer: Buffer): void {
  void (async () => {
    let success = false;
    let extractionMethod: string | null = null;
    const startedAt = performance.now();

    try {
      updateJob(job.id, {
        status: 'running',
        phase: 'extracting',
        progress: 10,
        message: 'Analyzing PDF fields.',
      });

      const result = await extractPdfSchemaResult(
        pdfBuffer,
        job.input.fileName,
        job.input.pdfHash,
        job.input.pdfSha256
      );

      success = true;
      extractionMethod = result.extractionMethod;
      updateJob<PdfExtractionResult>(job.id, {
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        message: `Field schema extracted (${countSchemaProperties(result.schema)} fields).`,
        result,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Extraction failed.';
      console.error('[pdf-filler/extract/job] error:', err);
      updateJob(job.id, {
        status: 'failed',
        phase: 'failed',
        progress: 100,
        message,
        error: message,
      });
    } finally {
      void insertPdfExtractionTelemetry({
        pdf_hash: job.input.pdfHash,
        file_size_bytes: job.input.fileSizeBytes,
        duration_ms: performance.now() - startedAt,
        cache_hit: false,
        extraction_method: extractionMethod,
        flow: 'extract_api',
        success,
      });
    }
  })();
}

function sendControllerError(res: Response, status: number, err: unknown, fallback: string): void {
  const message = err instanceof Error ? err.message : fallback;
  console.error(`[pdf-filler] ${fallback}:`, err);
  if (message.includes('extract-schema failed')) {
    res.status(502).json({ error: 'PDF analysis service unavailable or failed.', detail: message });
    return;
  }
  if (message.includes('fill failed')) {
    res.status(502).json({ error: 'PDF fill service unavailable or failed.', detail: message });
    return;
  }
  if (message.includes('Supabase is not configured')) {
    res.status(503).json({ error: message });
    return;
  }
  res.status(status).json({ error: fallback, detail: message });
}

/**
 * Accepts a blank PDF upload, resolves schema via Supabase cache or Railway extract-schema.
 */
export async function handleExtractionRequest(req: Request, res: Response): Promise<void> {
  const startedAt = performance.now();
  let fileSizeBytes = 0;
  let pdfHash: string | null = null;
  let cacheHit = false;
  let extractionMethod: string | null = null;
  let success = false;

  try {
    const fileName = sanitizeString(req.body.fileName, 255);
    const fileData = req.body.fileData as string | undefined;

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      res.status(400).json({ error: 'fileName must end with .pdf' });
      return;
    }

    const pdfBuffer = decodeBase64Pdf(fileData ?? '');
    fileSizeBytes = pdfBuffer.length;
    pdfHash = md5HexPdf(pdfBuffer);
    const pdfSha256 = sha256HexPdf(pdfBuffer);

    if (isFormTemplateCacheConfigured()) {
      const cached = await getGlobalSchemaByHash(pdfHash);
      if (cached) {
        const cachedSchema = prepareSidecarSchema(
          cached.schema_json as Record<string, unknown>
        );
        if (countSchemaProperties(cachedSchema) > 0) {
          cacheHit = true;
          extractionMethod = cached.extraction_method;
          success = true;
          res.json({
            pdfHash,
            pdfSha256,
            schema: cachedSchema,
            cacheHit: true,
            extractionMethod: cached.extraction_method,
            schemaVersion: cached.schema_version,
          });
          return;
        }
      }
    }

    const schema = prepareSidecarSchema(await extractSchemaFromPdf(pdfBuffer, fileName));
    if (countSchemaProperties(schema) === 0) {
      res.status(422).json({
        error: 'No form fields were detected in this PDF.',
        detail:
          'The analysis service returned an empty field layout. Try a clearer blank form, or re-run after the mapper service is updated.',
      });
      return;
    }
    const meta = schemaMeta(schema);
    extractionMethod = meta.extractionMethod;
    const { extractionMethod: extractionMethodOut, schemaVersion } = meta;

    if (isFormTemplateCacheConfigured() && countSchemaProperties(schema) > 0) {
      try {
        await upsertGlobalSchema({
          pdf_hash: pdfHash,
          schema_json: schema,
          extraction_method: extractionMethodOut,
          schema_version: schemaVersion,
        });
      } catch (cacheErr) {
        console.warn('[pdf-filler] cache upsert after extract (non-fatal):', cacheErr);
      }
    }

    success = true;
    res.json({
      pdfHash,
      pdfSha256,
      schema,
      cacheHit: false,
      extractionMethod: extractionMethodOut,
      schemaVersion,
    });
  } catch (err) {
    sendControllerError(res, 500, err, 'Extraction failed');
  } finally {
    if (fileSizeBytes > 0) {
      void insertPdfExtractionTelemetry({
        pdf_hash: pdfHash,
        file_size_bytes: fileSizeBytes,
        duration_ms: performance.now() - startedAt,
        cache_hit: cacheHit,
        extraction_method: extractionMethod,
        flow: 'extract_api',
        success,
      });
    }
  }
}

/**
 * Starts long-running extraction outside the Heroku request window.
 * Cache hits still return immediately with a completed result.
 */
export async function handleExtractionJobRequest(req: Request, res: Response): Promise<void> {
  const startedAt = performance.now();
  try {
    const fileName = sanitizeString(req.body.fileName, 255);
    const fileData = req.body.fileData as string | undefined;

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      res.status(400).json({ error: 'fileName must end with .pdf' });
      return;
    }

    const pdfBuffer = decodeBase64Pdf(fileData ?? '');
    const pdfHash = md5HexPdf(pdfBuffer);
    const pdfSha256 = sha256HexPdf(pdfBuffer);
    const cached = await loadCachedExtractionResult(pdfHash, pdfSha256);

    if (cached) {
      void insertPdfExtractionTelemetry({
        pdf_hash: pdfHash,
        file_size_bytes: pdfBuffer.length,
        duration_ms: performance.now() - startedAt,
        cache_hit: true,
        extraction_method: cached.extractionMethod,
        flow: 'extract_api',
        success: true,
      });
      res.json({ completed: true, result: cached });
      return;
    }

    const input: PdfExtractionJobInput = {
      fileName,
      pdfHash,
      pdfSha256,
      fileSizeBytes: pdfBuffer.length,
    };
    const job = createJob<PdfExtractionJobInput>('pdf-filler.extract', input, extractionActor(req));
    startExtractionJob(job, pdfBuffer);

    res.status(202).json({
      completed: false,
      jobId: job.id,
      job: serializeExtractionJob(job as StoredJob<unknown, PdfExtractionResult>),
    });
  } catch (err) {
    sendControllerError(res, 500, err, 'Extraction failed');
  }
}

export function handleExtractionJobStatus(req: Request, res: Response): void {
  const job = getJob<unknown, PdfExtractionResult>(String(req.params.jobId));
  if (!job || job.type !== 'pdf-filler.extract') {
    res.status(404).json({ error: 'Job not found.' });
    return;
  }
  if (!canViewExtractionJob(req, job)) {
    res.status(403).json({ error: 'You do not have access to this job.' });
    return;
  }
  res.json({ job: serializeExtractionJob(job) });
}

/**
 * Persists user-corrected schema into the global Supabase layout cache.
 */
export async function handleSaveTemplate(req: Request, res: Response): Promise<void> {
  try {
    if (!isFormTemplateCacheConfigured()) {
      res.status(503).json({
        error: 'Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
      });
      return;
    }

    const pdfHash = sanitizeString(req.body.pdfHash, 64).toLowerCase();
    const schema = req.body.schema as Record<string, unknown> | undefined;

    if (!isValidPdfHash(pdfHash)) {
      res.status(400).json({ error: 'pdfHash must be a 32-character MD5 hex string.' });
      return;
    }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      res.status(400).json({ error: 'schema must be a JSON object.' });
      return;
    }

    const extractionMethod =
      sanitizeString(req.body.extractionMethod, 64) || 'human_corrected';
    const schemaVersion = Number(req.body.schemaVersion ?? schema['x-schema-build-version'] ?? 1);

    await upsertGlobalSchema({
      pdf_hash: pdfHash,
      schema_json: schema,
      extraction_method: extractionMethod,
      schema_version: Number.isFinite(schemaVersion) ? schemaVersion : 1,
    });

    const baselineSchema = req.body.baselineSchema as Record<string, unknown> | undefined;
    if (baselineSchema && isFormLayoutCorrectionStoreConfigured()) {
      const baselineExtractionMethod = sanitizeString(req.body.baselineExtractionMethod, 64) || null;
      const baselineSchemaVersion = Number(
        baselineSchema['x-schema-build-version'] ?? req.body.baselineSchemaVersion ?? 1
      );
      const { field_changes, summary } = diffLayoutSchemas(baselineSchema, schema);
      if (field_changes.length > 0) {
        try {
          await insertLayoutCorrection({
            pdf_hash: pdfHash,
            baseline_extraction_method: baselineExtractionMethod,
            baseline_schema_version: Number.isFinite(baselineSchemaVersion)
              ? baselineSchemaVersion
              : null,
            field_changes,
            summary,
            saved_by: sanitizeString(req.session.userEmail ?? '', 320) || null,
          });
        } catch (telemetryErr) {
          console.warn('[pdf-filler] layout correction telemetry (non-fatal):', telemetryErr);
        }
      }
    }

    res.json({
      success: true,
      pdfHash,
      extractionMethod,
      schemaVersion: Number.isFinite(schemaVersion) ? schemaVersion : 1,
    });
  } catch (err) {
    sendControllerError(res, 500, err, 'Failed to save template schema to global cache');
  }
}

/**
 * Saves corrected schema to Supabase (when configured) and registers the template on the doctor's Drive
 * so patient Form Intelligence can list and fill it.
 */
export async function handlePublishPracticeTemplate(req: Request, res: Response): Promise<void> {
  try {
    const token = req.session.accessToken!;
    const fileName = sanitizeString(req.body.fileName, 255);
    const fileData = req.body.fileData as string | undefined;
    const pdfHash = sanitizeString(req.body.pdfHash, 64).toLowerCase();
    const schema = req.body.schema as Record<string, unknown> | undefined;
    const documentTypeRaw = sanitizeString(req.body.documentType, 64);
    const displayNameInput = sanitizeString(req.body.displayName, 255);
    const templateId = sanitizeString(req.body.templateId, 64) || undefined;
    const insuranceCompanyIdRaw = sanitizeString(req.body.insuranceCompanyId, 64);
    const keepPrivate = Boolean(req.body.keepPrivate);

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      res.status(400).json({ error: 'fileName must end with .pdf' });
      return;
    }
    if (!isValidPdfHash(pdfHash)) {
      res.status(400).json({ error: 'pdfHash must be a 32-character MD5 hex string.' });
      return;
    }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      res.status(400).json({ error: 'schema must be a JSON object.' });
      return;
    }
    if (!isPdfDocumentType(documentTypeRaw)) {
      res.status(400).json({ error: 'Invalid document type.' });
      return;
    }
    if (!fileData || typeof fileData !== 'string') {
      res.status(400).json({ error: 'fileData (base64 PDF) is required.' });
      return;
    }

    const pdfBuffer = decodeBase64Pdf(fileData);
    const computedHash = md5HexPdf(pdfBuffer);
    if (computedHash !== pdfHash) {
      res.status(400).json({ error: 'pdfHash does not match uploaded PDF bytes.' });
      return;
    }

    const inferred = await inferTemplateMetadataFromPdf(pdfBuffer, fileName);
    const merged = mergeTemplateMetadata({
      fileName,
      displayNameInput,
      documentTypeInput: documentTypeRaw,
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

    const extractionMethod =
      sanitizeString(req.body.extractionMethod, 64) || 'human_corrected';
    const schemaVersion = Number(req.body.schemaVersion ?? schema['x-schema-build-version'] ?? 1);
    const schemaWithMeta = {
      ...schema,
      'x-extraction-method': extractionMethod,
      'x-schema-build-version': Number.isFinite(schemaVersion) ? schemaVersion : 1,
    };

    if (isFormTemplateCacheConfigured()) {
      await upsertGlobalSchema({
        pdf_hash: pdfHash,
        schema_json: schemaWithMeta,
        extraction_method: extractionMethod,
        schema_version: Number.isFinite(schemaVersion) ? schemaVersion : 1,
      });
    }

    const baselineSchema = req.body.baselineSchema as Record<string, unknown> | undefined;
    if (baselineSchema && isFormLayoutCorrectionStoreConfigured()) {
      const baselineExtractionMethod = sanitizeString(req.body.baselineExtractionMethod, 64) || null;
      const baselineSchemaVersion = Number(
        baselineSchema['x-schema-build-version'] ?? req.body.baselineSchemaVersion ?? 1
      );
      const { field_changes, summary } = diffLayoutSchemas(baselineSchema, schemaWithMeta);
      if (field_changes.length > 0) {
        try {
          await insertLayoutCorrection({
            pdf_hash: pdfHash,
            baseline_extraction_method: baselineExtractionMethod,
            baseline_schema_version: Number.isFinite(baselineSchemaVersion)
              ? baselineSchemaVersion
              : null,
            field_changes,
            summary,
            saved_by: sanitizeString(req.session.userEmail ?? '', 320) || null,
          });
        } catch (telemetryErr) {
          console.warn('[pdf-filler] layout correction telemetry (non-fatal):', telemetryErr);
        }
      }
    }

    const stem = fileName.replace(/\.pdf$/i, '').trim() || 'template';
    const displayName = merged.displayName || displayNameInput || stem;

    const insuranceCompanyId =
      merged.documentType === 'insurance_form' ? merged.insuranceCompanyId : undefined;

    const template = await savePracticePdfTemplate({
      token,
      fileName,
      pdfBuffer,
      pdfHash,
      schema: schemaWithMeta,
      documentType: merged.documentType,
      displayName,
      templateId,
      insuranceCompanyId,
    });

    await registerTemplateSharing(req, {
      pdfHash,
      schema: schemaWithMeta,
      entry: template,
      keepPrivate,
    });

    res.json({
      success: true,
      pdfHash,
      template,
      globalCacheUpdated: isFormTemplateCacheConfigured(),
      inferredMetadata: merged.inferred,
    });
  } catch (err) {
    sendControllerError(res, 500, err, 'Failed to publish practice template');
  }
}

function parseValidatedMappingFields(raw: unknown): ValidatedMappingField[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: ValidatedMappingField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const fieldId = typeof row.field_id === 'string' ? row.field_id.trim() : '';
    if (!fieldId) return null;
    const page = Number(row.page);
    if (!Number.isFinite(page) || page < 1) return null;
    const action = row.action;
    if (
      action !== 'unchanged' &&
      action !== 'move' &&
      action !== 'resize' &&
      action !== 'add' &&
      action !== 'delete' &&
      action !== 'relabel'
    ) {
      return null;
    }
    const parseRect = (v: unknown, required: boolean): ValidatedMappingField['pred'] => {
      if (v == null) return required ? null : null;
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      const r = v as Record<string, unknown>;
      const x = Number(r.x);
      const y = Number(r.y);
      const width = Number(r.width);
      const height = Number(r.height);
      if (![x, y, width, height].every((n) => Number.isFinite(n))) return null;
      return { x, y, width, height };
    };
    const pred = parseRect(row.pred, false);
    const valid = parseRect(row.valid, true);
    if (!valid) return null;
    if (action === 'add' && pred !== null) return null;
    out.push({
      field_id: fieldId,
      page: Math.round(page),
      label: typeof row.label === 'string' ? row.label : null,
      field_type: typeof row.field_type === 'string' ? row.field_type : null,
      pred,
      valid,
      action,
    });
  }
  return out;
}

/**
 * Persists human-approved mapping corrections (service role) for model training telemetry.
 */
export async function handleApproveMapping(req: Request, res: Response): Promise<void> {
  try {
    if (!isMappingCorrectionStoreConfigured()) {
      res.status(503).json({
        error: 'Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).',
      });
      return;
    }

    const body = req.body as MappingFeedbackRequest;
    const extractionRunId = sanitizeString(body.extraction_run_id, 64);
    const pdfSha256 = sanitizeString(body.pdf_sha256, 128).toLowerCase();
    const sourceFilename = sanitizeString(body.source_filename ?? '', 512) || null;
    const predictionJson = body.prediction_json;
    const notes = sanitizeString(body.notes ?? '', 2000) || null;

    if (!UUID_RE.test(extractionRunId)) {
      res.status(400).json({ error: 'extraction_run_id must be a UUID.' });
      return;
    }
    if (!isValidPdfSha256(pdfSha256)) {
      res.status(400).json({ error: 'pdf_sha256 must be a 64-character hex SHA-256 digest.' });
      return;
    }
    if (!predictionJson || typeof predictionJson !== 'object' || Array.isArray(predictionJson)) {
      res.status(400).json({ error: 'prediction_json must be a JSON object.' });
      return;
    }
    const predictionSha =
      typeof predictionJson.pdf_sha256 === 'string'
        ? predictionJson.pdf_sha256.toLowerCase()
        : null;
    if (predictionSha && SHA256_HEX_RE.test(predictionSha) && predictionSha !== pdfSha256) {
      res.status(400).json({ error: 'pdf_sha256 does not match prediction_json.pdf_sha256.' });
      return;
    }

    const validatedFields = parseValidatedMappingFields(body.validated_fields);
    if (!validatedFields) {
      res.status(400).json({
        error: 'validated_fields must be a non-empty array of field correction rows.',
      });
      return;
    }

    const { correctionId } = await insertMappingApproval({
      extractionRunId,
      pdfSha256,
      sourceFilename,
      predictionJson: { ...predictionJson, pdf_sha256: pdfSha256 },
      validatedFields,
      reviewerId: null,
      notes,
    });

    res.json({
      success: true,
      extraction_run_id: extractionRunId,
      correction_id: correctionId,
      field_count: validatedFields.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Approve mapping failed';
    if (message.includes('duplicate key') || message.includes('mapping_corrections_one_per_run_key')) {
      res.status(409).json({ error: 'This extraction run was already approved.', detail: message });
      return;
    }
    sendControllerError(res, 500, err, 'Failed to approve mapping');
  }
}

/**
 * Proxies fill to Railway and streams application/pdf back to the UI.
 */
export async function handleFillRequest(req: Request, res: Response): Promise<void> {
  try {
    const fileData = req.body.fileData as string | undefined;
    const schema = req.body.schema as Record<string, unknown> | undefined;
    const answers = req.body.answers as Record<string, unknown> | undefined;
    const downloadName = sanitizeString(req.body.fileName, 255) || 'filled.pdf';

    const pdfBuffer = decodeBase64Pdf(fileData ?? '');

    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      res.status(400).json({ error: 'schema must be a JSON object.' });
      return;
    }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      res.status(400).json({ error: 'answers must be a JSON object.' });
      return;
    }

    const sidecarRes = await fillPdfViaSidecarResponse(pdfBuffer, schema, answers);

    if (!sidecarRes.ok) {
      const detail = await sidecarRes.text().catch(() => '');
      res.status(502).json({
        error: 'PDF fill service failed.',
        detail: detail || `HTTP ${sidecarRes.status}`,
      });
      return;
    }

    if (!sidecarRes.body) {
      res.status(502).json({ error: 'PDF fill service returned an empty body.' });
      return;
    }

    const contentLength = sidecarRes.headers.get('content-length');
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    const safeName = downloadName.toLowerCase().endsWith('.pdf') ? downloadName : `${downloadName}.pdf`;

    await pipeWebStreamToExpress(res, sidecarRes.body, {
      contentType: sidecarRes.headers.get('content-type') || 'application/pdf',
      contentDisposition: `attachment; filename="${safeName.replace(/"/g, '')}"`,
    });
  } catch (err) {
    if (!res.headersSent) {
      sendControllerError(res, 500, err, 'Fill failed');
    }
  }
}
