import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerativeModel } from '@google/generative-ai';
import { config } from '../config';
import type { PatientSummaryState } from '../../shared/types';
import type { PdfSchemaFieldDescriptor } from '../utils/pdfSchemaUtils';
import { GEMINI_TIMEOUT_MS, safeJsonParse, withRetry } from './gemini';

const AUTOFILL_MODEL =
  process.env.PDF_AUTOFILL_GEMINI_MODEL?.trim() || 'gemini-2.5-flash-lite';
const AUTOFILL_SINGLE_CALL_MAX_FIELDS = 45;
const AUTOFILL_FIELD_BATCH_SIZE = 45;

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

function isActiveMedicationStatus(status: string | undefined): boolean {
  const s = (status || '').toLowerCase();
  if (!s) return true;
  return !/(historic|historical|stopped|discontinued|inactive)/.test(s);
}

/** Compact JSON context for gap-fill LLM calls. */
export function compactContext(state: PatientSummaryState): string {
  const facts = state.structuredFacts;
  const medications = facts.medications
    .filter((m) => isActiveMedicationStatus(m.status))
    .slice(0, 20)
    .map((m) => ({
      name: m.name,
      strength: m.strength,
      dosage: m.dosage,
      frequency: m.frequency,
    }));
  const diagnoses = facts.diagnoses.slice(0, 15).map((d) => ({
    description: d.description,
    icd10Code: d.icd10Code,
    status: d.status,
  }));
  const timeline = [...state.timeline]
    .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))
    .slice(0, 10)
    .map((e) => ({
      date: e.dateLabel,
      title: e.title,
      bullets: e.bullets.slice(0, 3),
    }));

  const payload = {
    profile: state.profile,
    snapshot: state.snapshot.slice(0, 8),
    diagnoses,
    medications,
    procedures: facts.procedures.slice(0, 8).map((p) => p.name),
    investigations: facts.investigations.slice(0, 8).map((i) => ({
      type: i.type,
      name: i.name,
      result: i.result,
    })),
    timeline,
  };

  return JSON.stringify(payload);
}

function buildAutofillPrompt(
  schemaFields: PdfSchemaFieldDescriptor[],
  contextJson: string
): string {
  return `You are a clinical data extraction assistant.

Given compact patient summary JSON and PDF form fields, extract the best matching value for each field id from the summary only.

Rules:
- Return ONLY a JSON object (no markdown fences).
- Keys must be exactly the field "id" strings from schema_fields.
- Values must be strings suitable to type into the form, or null if the summary does not contain that information.
- Do not invent or guess clinical data not supported by the summary.
- For boolean/checkbox fields, use "Yes" or "No" when appropriate, or null.

schema_fields:
${JSON.stringify(schemaFields)}

patient_summary_compact_json:
${contextJson}
`;
}

async function extractFieldBatch(
  model: GenerativeModel,
  schemaFields: PdfSchemaFieldDescriptor[],
  contextJson: string
): Promise<Record<string, string | null>> {
  const expectedIds = schemaFields.map((f) => f.id).filter(Boolean);
  if (expectedIds.length === 0) return {};

  const prompt = buildAutofillPrompt(schemaFields, contextJson);
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

/** LLM gap-fill for fields not resolved by deterministic prefill. */
export async function extractDataFromPatientSummary(
  schemaFields: PdfSchemaFieldDescriptor[],
  summaryState: PatientSummaryState
): Promise<Record<string, string | null>> {
  const expectedIds = schemaFields.map((f) => f.id).filter(Boolean);
  if (expectedIds.length === 0) return {};

  const contextJson = compactContext(summaryState);
  if (!contextJson || contextJson === '{}') return emptyResult(schemaFields);

  const genAI = new GoogleGenerativeAI(config.geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: AUTOFILL_MODEL,
    generationConfig: {
      temperature: 0.15,
      responseMimeType: 'application/json',
    },
  });

  if (schemaFields.length <= AUTOFILL_SINGLE_CALL_MAX_FIELDS) {
    return extractFieldBatch(model, schemaFields, contextJson);
  }

  const batches: PdfSchemaFieldDescriptor[][] = [];
  for (let i = 0; i < schemaFields.length; i += AUTOFILL_FIELD_BATCH_SIZE) {
    batches.push(schemaFields.slice(i, i + AUTOFILL_FIELD_BATCH_SIZE));
  }

  const partials = await Promise.all(
    batches.map((batch) => extractFieldBatch(model, batch, contextJson))
  );

  return Object.assign({}, ...partials);
}
