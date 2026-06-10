import { config } from '../config';
import { GEMINI_TIMEOUT_MS } from './gemini';

const SIDECAR_TIMEOUT_MS = GEMINI_TIMEOUT_MS + 30_000;

function sidecarHeaders(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType) headers['Content-Type'] = contentType;
  if (config.pdfFillerServiceSecret) {
    headers['X-Pdf-Filler-Secret'] = config.pdfFillerServiceSecret;
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
    headers: sidecarHeaders(),
    body: form,
    signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
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
  const res = await fetch(`${config.pdfFillerServiceUrl}/api/fill`, {
    method: 'POST',
    headers: sidecarHeaders('application/json'),
    body: JSON.stringify({
      pdf_base64: pdfBuffer.toString('base64'),
      schema,
      answers,
    }),
    signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PDF filler fill failed (${res.status}): ${text}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
