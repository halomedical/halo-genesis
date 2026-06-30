import { enrichSchemaWithFieldInference } from '../../shared/pdfFieldInference';

const SCHEMA_META_KEYS = new Set(['type', 'title', 'description', 'required', '$schema', 'properties']);

function looksLikeFieldProp(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prop = value as Record<string, unknown>;
  const layoutKeys = ['x', 'y', 'width', 'height', 'x-page', 'page', 'left', 'top'];
  if (layoutKeys.some((k) => typeof prop[k] === 'number' || typeof prop[k] === 'string')) {
    return true;
  }
  return (
    (prop.type === 'string' || prop.type === 'boolean' || prop.type === 'checkbox') &&
    (typeof prop.title === 'string' || typeof prop.label === 'string')
  );
}

/**
 * Gemini often returns `{ field_key: { type, title, x, ... } }` without a `properties` wrapper.
 * Ensures halo-genesis and the UI always see a JSON Schema-shaped object.
 */
export function normalizeSidecarSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const existing = schema.properties;
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const keys = Object.keys(existing as Record<string, unknown>);
    if (keys.length > 0) return schema;
  }

  const rootFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (SCHEMA_META_KEYS.has(key)) continue;
    if (key.startsWith('x-')) continue;
    if (looksLikeFieldProp(value)) rootFields[key] = value;
  }

  if (Object.keys(rootFields).length === 0) return schema;
  return { ...schema, properties: rootFields };
}

export type PdfSchemaFieldDescriptor = { id: string; title: string; type: string };

export function prepareSidecarSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return enrichSchemaWithFieldInference(normalizeSidecarSchema(schema));
}

/** Build sidecar autofill field list from a JSON Schema object. */
export function schemaPropertiesToFields(
  schema: Record<string, unknown>
): PdfSchemaFieldDescriptor[] {
  const normalized = normalizeSidecarSchema(schema);
  const properties = normalized.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return [];
  }
  return Object.entries(properties as Record<string, Record<string, unknown>>).map(
    ([key, prop]) => ({
      id: key,
      title: typeof prop.title === 'string' && prop.title.trim() ? prop.title.trim() : key,
      type: typeof prop.type === 'string' ? prop.type : 'string',
    })
  );
}

/** Count fillable keys in a JSON Schema object returned by the sidecar. */
export function countSchemaProperties(schema: Record<string, unknown> | null | undefined): number {
  if (!schema || typeof schema !== 'object') return 0;
  const normalized = normalizeSidecarSchema(schema);
  const properties = normalized.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return 0;
  return Object.keys(properties as Record<string, unknown>).length;
}

/** Fields eligible for patient-summary Gemini autofill. */
export function schemaFieldsForSummaryAutofill(
  schema: Record<string, unknown>
): PdfSchemaFieldDescriptor[] {
  const normalized = normalizeSidecarSchema(schema);
  const properties = normalized.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return [];
  }
  const props = properties as Record<string, Record<string, unknown>>;
  return Object.entries(props)
    .filter(([, prop]) => {
      const src = prop['x-data-source'];
      return src === 'patient_summary' || src === undefined;
    })
    .map(([key, prop]) => ({
      id: key,
      title: typeof prop.title === 'string' && prop.title.trim() ? prop.title.trim() : key,
      type: typeof prop.type === 'string' ? prop.type : 'string',
    }));
}
