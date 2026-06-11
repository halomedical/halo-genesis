import { Request, Response } from 'express';
import { isPdfDocumentType } from '../../shared/pdfFiller';
import { sanitizeString } from '../services/drive';
import { savePracticePdfTemplate } from '../services/practicePdfTemplateStore';
import {
  extractSchemaFromPdf,
  fillPdfViaSidecarResponse,
} from '../services/pdfFillerClient';
import {
  getGlobalSchemaByHash,
  isFormTemplateCacheConfigured,
  upsertGlobalSchema,
} from '../services/formTemplateCache';
import { isValidPdfHash, md5HexPdf } from '../services/pdfHash';
import { decodeBase64Pdf, pipeWebStreamToExpress } from '../utils/streamUtils';
import { countSchemaProperties, normalizeSidecarSchema } from '../utils/pdfSchemaUtils';
import { diffLayoutSchemas } from '../utils/schemaLayoutDiff';
import {
  insertLayoutCorrection,
  isFormLayoutCorrectionStoreConfigured,
} from '../services/formLayoutCorrectionStore';

function schemaMeta(schema: Record<string, unknown>): {
  extractionMethod: string;
  schemaVersion: number;
} {
  return {
    extractionMethod: String(schema['x-extraction-method'] ?? 'unknown'),
    schemaVersion: Number(schema['x-schema-build-version'] ?? 1),
  };
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
  try {
    const fileName = sanitizeString(req.body.fileName, 255);
    const fileData = req.body.fileData as string | undefined;

    if (!fileName.toLowerCase().endsWith('.pdf')) {
      res.status(400).json({ error: 'fileName must end with .pdf' });
      return;
    }

    const pdfBuffer = decodeBase64Pdf(fileData ?? '');
    const pdfHash = md5HexPdf(pdfBuffer);

    if (isFormTemplateCacheConfigured()) {
      const cached = await getGlobalSchemaByHash(pdfHash);
      if (cached) {
        const cachedSchema = normalizeSidecarSchema(
          cached.schema_json as Record<string, unknown>
        );
        if (countSchemaProperties(cachedSchema) > 0) {
          res.json({
            pdfHash,
            schema: cachedSchema,
            cacheHit: true,
            extractionMethod: cached.extraction_method,
            schemaVersion: cached.schema_version,
          });
          return;
        }
      }
    }

    const schema = normalizeSidecarSchema(await extractSchemaFromPdf(pdfBuffer, fileName));
    if (countSchemaProperties(schema) === 0) {
      res.status(422).json({
        error: 'No form fields were detected in this PDF.',
        detail:
          'The analysis service returned an empty field layout. Try a clearer blank form, or re-run after the mapper service is updated.',
      });
      return;
    }
    const { extractionMethod, schemaVersion } = schemaMeta(schema);

    if (isFormTemplateCacheConfigured() && countSchemaProperties(schema) > 0) {
      try {
        await upsertGlobalSchema({
          pdf_hash: pdfHash,
          schema_json: schema,
          extraction_method: extractionMethod,
          schema_version: schemaVersion,
        });
      } catch (cacheErr) {
        console.warn('[pdf-filler] cache upsert after extract (non-fatal):', cacheErr);
      }
    }

    res.json({
      pdfHash,
      schema,
      cacheHit: false,
      extractionMethod,
      schemaVersion,
    });
  } catch (err) {
    sendControllerError(res, 500, err, 'Extraction failed');
  }
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
    const displayName = displayNameInput || stem;

    const template = await savePracticePdfTemplate({
      token,
      fileName,
      pdfBuffer,
      pdfHash,
      schema: schemaWithMeta,
      documentType: documentTypeRaw,
      displayName,
      templateId,
    });

    res.json({
      success: true,
      pdfHash,
      template,
      globalCacheUpdated: isFormTemplateCacheConfigured(),
    });
  } catch (err) {
    sendControllerError(res, 500, err, 'Failed to publish practice template');
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
