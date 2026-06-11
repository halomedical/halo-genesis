import type { Response } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { PDF_FILLER_MAX_BYTES } from './pdfFillerLimits';

export function estimateBase64DecodedBytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function decodeBase64Pdf(fileData: string, maxBytes = PDF_FILLER_MAX_BYTES): Buffer {
  if (!fileData || typeof fileData !== 'string') {
    throw new Error('File data is required (base64).');
  }
  const estimated = estimateBase64DecodedBytes(fileData);
  if (estimated > maxBytes) {
    throw new Error(`File too large. Maximum size is ${maxBytes / (1024 * 1024)}MB.`);
  }
  const buffer = Buffer.from(fileData, 'base64');
  if (buffer.length > maxBytes) {
    throw new Error(`File too large. Maximum size is ${maxBytes / (1024 * 1024)}MB.`);
  }
  return buffer;
}

/** Bounded read of a Fetch API body (fallback when streaming to Drive is not used). */
export async function readWebStreamToBuffer(
  body: ReadableStream<Uint8Array>,
  maxBytes = PDF_FILLER_MAX_BYTES
): Promise<Buffer> {
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(`Response exceeds maximum size of ${maxBytes / (1024 * 1024)}MB.`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

/**
 * Pipe an upstream Fetch body to the Express response without buffering the full PDF in Node.
 */
export async function pipeWebStreamToExpress(
  res: Response,
  body: ReadableStream<Uint8Array>,
  headers: { contentType?: string; contentDisposition?: string }
): Promise<void> {
  if (headers.contentType) {
    res.setHeader('Content-Type', headers.contentType);
  }
  if (headers.contentDisposition) {
    res.setHeader('Content-Disposition', headers.contentDisposition);
  }

  const nodeStream = Readable.fromWeb(body);
  nodeStream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Stream error while generating PDF.', detail: err.message });
    } else {
      res.destroy(err);
    }
  });

  await pipeline(nodeStream, res);
}
