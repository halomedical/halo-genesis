/**
 * Human-in-the-loop mapping feedback (pdf-filler mapping_feedback_contract).
 * Coordinates only — no patient values.
 */

export type MappingCorrectionAction =
  | 'unchanged'
  | 'move'
  | 'resize'
  | 'add'
  | 'delete'
  | 'relabel';

export interface FieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ValidatedMappingField {
  field_id: string;
  page: number;
  label?: string | null;
  field_type?: string | null;
  pred: FieldRect | null;
  valid: FieldRect;
  action: MappingCorrectionAction;
}

export interface MappingFeedbackRequest {
  extraction_run_id: string;
  pdf_sha256: string;
  source_filename?: string | null;
  prediction_json: Record<string, unknown>;
  validated_fields: ValidatedMappingField[];
  notes?: string | null;
}

const LAYOUT_EPS = 0.5;

type JsonProp = Record<string, unknown>;

function asNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function readPage(prop: JsonProp): number {
  const page = asNum(prop['x-page'] ?? prop.page, 1);
  return Math.max(1, Math.round(page));
}

function rectFromProp(prop: JsonProp): FieldRect {
  return {
    x: asNum(prop.x, 0),
    y: asNum(prop.y, 0),
    width: Math.max(asNum(prop.width, 80), 1),
    height: Math.max(asNum(prop.height, 18), 1),
  };
}

function labelFromProp(key: string, prop: JsonProp): string {
  const title = prop.title;
  return typeof title === 'string' && title.trim() ? title.trim() : key;
}

function fieldTypeFromProp(prop: JsonProp): string {
  const t = prop.type;
  if (typeof t === 'string' && t.trim()) return t;
  if (prop.format === 'date') return 'string';
  return 'string';
}

function isFiniteNum(v: unknown): boolean {
  if (typeof v === 'number' && Number.isFinite(v)) return true;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n);
  }
  return false;
}

function hasLayout(prop: JsonProp): boolean {
  return (
    isFiniteNum(prop.x) ||
    isFiniteNum(prop.y) ||
    isFiniteNum(prop.width) ||
    isFiniteNum(prop.height)
  );
}

function positionEqual(a: FieldRect, b: FieldRect, pageA: number, pageB: number): boolean {
  return (
    pageA === pageB &&
    Math.abs(a.x - b.x) < LAYOUT_EPS &&
    Math.abs(a.y - b.y) < LAYOUT_EPS
  );
}

function sizeEqual(a: FieldRect, b: FieldRect): boolean {
  return Math.abs(a.width - b.width) < LAYOUT_EPS && Math.abs(a.height - b.height) < LAYOUT_EPS;
}

function layoutEqual(a: FieldRect, b: FieldRect, pageA: number, pageB: number): boolean {
  return positionEqual(a, b, pageA, pageB) && sizeEqual(a, b);
}

function classifyAction(
  pred: FieldRect | null,
  valid: FieldRect,
  predPage: number,
  validPage: number,
  labelChanged: boolean
): MappingCorrectionAction {
  if (!pred) return 'add';
  if (labelChanged && layoutEqual(pred, valid, predPage, validPage)) return 'relabel';
  if (layoutEqual(pred, valid, predPage, validPage)) return 'unchanged';
  const moved = !positionEqual(pred, valid, predPage, validPage);
  const resized = !sizeEqual(pred, valid);
  if (moved && resized) return 'move';
  if (moved) return 'move';
  if (resized) return 'resize';
  return 'unchanged';
}

export function schemaFieldsToMappedList(schema: Record<string, unknown>): Array<{
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  field_type: string;
}> {
  const properties = (schema.properties ?? {}) as Record<string, JsonProp>;
  const out: Array<{
    id: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    field_type: string;
  }> = [];
  for (const [key, prop] of Object.entries(properties)) {
    if (!hasLayout(prop)) continue;
    const rect = rectFromProp(prop);
    out.push({
      id: key,
      page: readPage(prop),
      ...rect,
      label: labelFromProp(key, prop),
      field_type: fieldTypeFromProp(prop),
    });
  }
  return out;
}

/** Wrap Genesis extract-schema JSON into an /api/extract-shaped prediction snapshot. */
export function buildPredictionJsonFromExtractSchema(
  schema: Record<string, unknown>,
  meta?: {
    sourceFilename?: string | null;
    extractionMethod?: string | null;
    schemaVersion?: number | null;
  }
): Record<string, unknown> {
  const fields = schemaFieldsToMappedList(schema);
  const extractionMethod = meta?.extractionMethod ?? String(schema['x-extraction-method'] ?? 'unknown');
  const schemaVersion = meta?.schemaVersion ?? Number(schema['x-schema-build-version'] ?? 1);
  return {
    source: 'halo-genesis-extract-schema',
    coordinate_system: 'pdf_points_top_left_y_down',
    pipeline_version: `genesis-schema-v${Number.isFinite(schemaVersion) ? schemaVersion : 1}`,
    extraction_method: extractionMethod,
    source_filename: meta?.sourceFilename ?? null,
    json_schema: schema,
    mapped_fields: { fields },
  };
}

export function buildValidatedFieldsFromSchemas(
  predictionSchema: Record<string, unknown>,
  validatedSchema: Record<string, unknown>
): ValidatedMappingField[] {
  const baseProps = (predictionSchema.properties ?? {}) as Record<string, JsonProp>;
  const validProps = (validatedSchema.properties ?? {}) as Record<string, JsonProp>;
  const keys = new Set([...Object.keys(baseProps), ...Object.keys(validProps)]);
  const rows: ValidatedMappingField[] = [];

  for (const fieldId of keys) {
    const before = baseProps[fieldId];
    const after = validProps[fieldId];

    if (!after && before && hasLayout(before)) {
      const predRect = rectFromProp(before);
      const predPage = readPage(before);
      rows.push({
        field_id: fieldId,
        page: predPage,
        label: labelFromProp(fieldId, before),
        field_type: fieldTypeFromProp(before),
        pred: predRect,
        valid: predRect,
        action: 'delete',
      });
      continue;
    }

    if (!after || !hasLayout(after)) continue;

    const validRect = rectFromProp(after);
    const validPage = readPage(after);
    const validLabel = labelFromProp(fieldId, after);

    if (!before || !hasLayout(before)) {
      rows.push({
        field_id: fieldId,
        page: validPage,
        label: validLabel,
        field_type: fieldTypeFromProp(after),
        pred: null,
        valid: validRect,
        action: 'add',
      });
      continue;
    }

    const predRect = rectFromProp(before);
    const predPage = readPage(before);
    const predLabel = labelFromProp(fieldId, before);
    const labelChanged = predLabel !== validLabel;
    const action = classifyAction(predRect, validRect, predPage, validPage, labelChanged);

    rows.push({
      field_id: fieldId,
      page: validPage,
      label: validLabel,
      field_type: fieldTypeFromProp(after),
      pred: predRect,
      valid: validRect,
      action,
    });
  }

  return rows.sort((a, b) => a.page - b.page || a.field_id.localeCompare(b.field_id));
}

export function buildValidatedJsonFromFields(
  validatedFields: ValidatedMappingField[]
): Record<string, unknown> {
  return {
    fields: validatedFields
      .filter((f) => f.action !== 'delete')
      .map((f) => ({
        id: f.field_id,
        page: f.page,
        x: f.valid.x,
        y: f.valid.y,
        width: f.valid.width,
        height: f.valid.height,
        label: f.label ?? f.field_id,
        field_type: f.field_type ?? 'string',
      })),
  };
}

export function summarizeMappingActions(
  validatedFields: ValidatedMappingField[]
): Record<string, number> {
  const summary: Record<string, number> = {
    unchanged: 0,
    move: 0,
    resize: 0,
    add: 0,
    delete: 0,
    relabel: 0,
  };
  for (const f of validatedFields) {
    summary[f.action] = (summary[f.action] ?? 0) + 1;
  }
  return summary;
}

export const SHA256_HEX_RE = /^[a-f0-9]{64}$/i;
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
