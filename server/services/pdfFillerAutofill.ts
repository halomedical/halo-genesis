import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config';
import type { PdfSchemaFieldDescriptor } from '../utils/pdfSchemaUtils';
import { GEMINI_TIMEOUT_MS, safeJsonParse, withRetry } from './gemini';

const AUTOFILL_MODEL = 'gemini-2.5-flash';

function emptyResult(schemaFields: PdfSchemaFieldDescriptor[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of schemaFields) {
    if (field.id) out[field.id] = null;
  }
  return out;
}

function coerceValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No';
  if (typeof raw === 'number') return String(raw);
  if (typeof raw === 'string') {
    const stripped = raw.trim();
    return stripped ? stripped : null;
  }
  return null;
}

function normalizeExtraction(
  data: Record<string, unknown>,
  expectedIds: string[]
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const id of expectedIds) {
    out[id] = id in data ? coerceValue(data[id]) : null;
  }
  return out;
}

/**
 * Map form schema fields to values found in patient summary markdown (Genesis-hosted Gemini).
 * Used when the pdf-mapper sidecar autofill route is unavailable.
 */
export async function extractDataFromPatientSummary(
  schemaFields: PdfSchemaFieldDescriptor[],
  markdownText: string
): Promise<Record<string, string | null>> {
  const expectedIds = schemaFields.map((f) => f.id).filter(Boolean);
  if (expectedIds.length === 0) return {};
  if (!markdownText.trim()) return emptyResult(schemaFields);

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: AUTOFILL_MODEL,
    generationConfig: {
      temperature: 0.15,
      responseMimeType: 'application/json',
    },
  });

  const prompt = `You are a clinical data extraction assistant.

Given a patient summary in Markdown and a list of PDF form fields, extract the best matching value for each field id from the summary only.

Rules:
- Return ONLY a JSON object (no markdown fences).
- Keys must be exactly the field "id" strings from schema_fields.
- Values must be strings suitable to type into the form, or null if the summary does not contain that information.
- Do not invent or guess clinical data not supported by the summary.
- For boolean/checkbox fields, use "Yes" or "No" when appropriate, or null.

schema_fields:
${JSON.stringify(schemaFields)}

patient_summary_markdown:
${markdownText}
`;

  const result = await withRetry(() =>
    model.generateContent(prompt, { timeout: GEMINI_TIMEOUT_MS })
  );
  const text = result.response.text();
  const parsed = safeJsonParse<Record<string, unknown>>(text, {});
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return emptyResult(schemaFields);
  }
  return normalizeExtraction(parsed, expectedIds);
}
