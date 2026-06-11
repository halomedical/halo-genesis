import { config } from '../config';
import { GEMINI_TIMEOUT_MS } from './gemini';
import { PDF_FILLER_FILL_TIMEOUT_MS } from '../utils/pdfFillerLimits';
import { readWebStreamToBuffer } from '../utils/streamUtils';

const EXTRACT_TIMEOUT_MS = GEMINI_TIMEOUT_MS + 30_000;
const AUTOFILL_TIMEOUT_MS = GEMINI_TIMEOUT_MS + 30_000;
const GENERATE_ENRICH_TIMEOUT_MS = PDF_FILLER_FILL_TIMEOUT_MS + 30_000;

export type PdfSchemaFieldDescriptor = { id: string; title: string; type: string };

export function pdfFillerSidecarHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  const secret = config.pdfFillerServiceSecret;
  if (secret) {
    headers['X-Pdf-Filler-Secret'] = secret;
    headers['Authorization'] = `Bearer ${secret}`;
  }
  return headers;
}

export async function pdfFillerHealthCheck(): Promise<boolean> {
  try {
    const res = await fetch(`${config.pdfFillerServiceUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function extractSchemaFromPdf(
  pdfBuffer: Buffer,
  fileName: string
): Promise<Record<string, unknown>> {
  const form = new FormData();
  const blob = new Blob([Uint8Array.from(pdfBuffer)], { type: 'application/pdf' });
  form.append('file', blob, fileName);

  const res = await fetch(`${config.pdfFillerServiceUrl}/api/extract-schema`, {
    method: 'POST',
    headers: pdfFillerSidecarHeaders(),
    body: form,
    signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PDF filler extract-schema failed (${res.status}): ${text}`);
  }

  return (await res.json()) as Record<string, unknown>;
}

export async function fillPdfViaSidecar(
  pdfBuffer: Buffer,
  schema: Record<string, unknown>,
  answers: Record<string, unknown>
): Promise<Buffer> {
  const res = await fillPdfViaSidecarResponse(pdfBuffer, schema, answers);
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`PDF filler fill failed (${res.status}): ${text}`);
  }
  return readWebStreamToBuffer(res.body);
}

/** Returns the raw Fetch response so callers can stream `body` to the client. */
export async function fillPdfViaSidecarResponse(
  pdfBuffer: Buffer,
  schema: Record<string, unknown>,
  answers: Record<string, unknown>
): Promise<Response> {
  return fetch(`${config.pdfFillerServiceUrl}/api/fill`, {
    method: 'POST',
    headers: pdfFillerSidecarHeaders('application/json'),
    body: JSON.stringify({
      pdf_base64: pdfBuffer.toString('base64'),
      schema,
      answers,
    }),
    signal: AbortSignal.timeout(PDF_FILLER_FILL_TIMEOUT_MS),
  });
}

export async function autofillFromPatientSummary(
  markdown: string,
  schemaFields: PdfSchemaFieldDescriptor[],
  patientId?: string
): Promise<Record<string, string | null>> {
  const res = await fetch(`${config.pdfFillerServiceUrl}/api/autofill`, {
    method: 'POST',
    headers: pdfFillerSidecarHeaders('application/json'),
    body: JSON.stringify({
      schema_fields: schemaFields,
      markdown_text: markdown,
      patient_id: patientId,
    }),
    signal: AbortSignal.timeout(AUTOFILL_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PDF filler autofill failed (${res.status}): ${text}`);
  }

  return (await res.json()) as Record<string, string | null>;
}

export async function generateAndEnrichViaSidecar(params: {
  pdfBuffer: Buffer;
  schema: Record<string, unknown>;
  finalFormData: Record<string, unknown>;
  markdown?: string;
  newlyAddedData?: Record<string, unknown>;
  schemaFields?: PdfSchemaFieldDescriptor[];
  patientId?: string;
}): Promise<{ pdfBuffer: Buffer; enrichedMarkdown: string; markdownUpdated: boolean }> {
  const res = await fetch(`${config.pdfFillerServiceUrl}/api/generate-and-enrich`, {
    method: 'POST',
    headers: pdfFillerSidecarHeaders('application/json'),
    body: JSON.stringify({
      pdf_base64: params.pdfBuffer.toString('base64'),
      schema: params.schema,
      final_form_data: params.finalFormData,
      markdown_text: params.markdown ?? '',
      newly_added_data: params.newlyAddedData ?? {},
      schema_fields: params.schemaFields,
      patient_id: params.patientId,
    }),
    signal: AbortSignal.timeout(GENERATE_ENRICH_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PDF filler generate-and-enrich failed (${res.status}): ${text}`);
  }

  const body = (await res.json()) as {
    pdf_base64: string;
    enriched_markdown: string;
    markdown_updated?: boolean;
  };
  return {
    pdfBuffer: Buffer.from(body.pdf_base64, 'base64'),
    enrichedMarkdown: body.enriched_markdown ?? params.markdown ?? '',
    markdownUpdated: Boolean(body.markdown_updated),
  };
}
