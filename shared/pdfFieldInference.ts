/**
 * Heuristics for PDF form field type and fill metadata (Template Studio + extract pipeline).
 */

export type PdfFieldDataSource =
  | 'patient_summary'
  | 'patient_record'
  | 'clinician_profile'
  | 'none';

export type PdfFieldFilledBy = 'patient' | 'clinician';

export type PdfFillReview = 'suggested' | 'confirmed';

export type InferredFieldType = 'text' | 'date' | 'checkbox' | 'number';

export interface FieldInferenceInput {
  key: string;
  title: string;
  width?: number;
  height?: number;
  type?: string;
  format?: string;
}

export interface FieldInferenceResult {
  fieldType: InferredFieldType;
  dataSource: PdfFieldDataSource;
  filledBy: PdfFieldFilledBy;
  fillReview: PdfFillReview;
}

const DATE_LABEL =
  /\b(date|dob|d\.o\.b|birth|admission|discharge|signed on|expiry|expires)\b/i;
const NUMBER_LABEL =
  /\b(age|score|sofa|amount|number|qty|quantity|count|days|hours|weight|height|kg|cm|mmhg|%)\b/i;
const CHECKBOX_LABEL =
  /\b(check|tick|yes\s*\/\s*no|agree|consent|confirm|accept|decline)\b/i;
const SIGNATURE_LABEL = /\b(signature|sign here|signed)\b/i;
const PATIENT_LABEL =
  /\b(patient|member|dependant|insured|policyholder|applicant)\b/i;
const CLINICIAN_LABEL =
  /\b(doctor|physician|clinician|treating|practitioner|mp\b|hpcsa|reg no|registration)\b/i;
const SUMMARY_LABEL =
  /\b(diagnosis|history|complaint|summary|clinical|findings|plan|medication|allerg)/i;
const RECORD_LABEL =
  /\b(name|surname|id number|identity|medical aid|member number|scheme|plan|folder|file number|address|contact|email|phone)\b/i;

function labelBlob(key: string, title: string): string {
  return `${key} ${title}`.toLowerCase();
}

export function inferFieldType(input: FieldInferenceInput): InferredFieldType {
  if (input.type === 'boolean') return 'checkbox';
  if (input.type === 'integer' || input.type === 'number') return 'number';
  if (input.format === 'date') return 'date';

  const blob = labelBlob(input.key, input.title);
  const w = input.width ?? 80;
  const h = input.height ?? 18;
  const squareish = w > 0 && h > 0 && w / h < 1.35 && w < 28 && h < 28;

  if (squareish || CHECKBOX_LABEL.test(blob)) return 'checkbox';
  if (DATE_LABEL.test(blob)) return 'date';
  if (NUMBER_LABEL.test(blob) && !DATE_LABEL.test(blob)) return 'number';
  return 'text';
}

export function inferFillMetadata(input: FieldInferenceInput): Pick<
  FieldInferenceResult,
  'dataSource' | 'filledBy'
> {
  const blob = labelBlob(input.key, input.title);

  if (SIGNATURE_LABEL.test(blob)) {
    const patientSign = /\bpatient\b/i.test(blob);
    return {
      dataSource: 'none',
      filledBy: patientSign ? 'patient' : 'clinician',
    };
  }

  if (CLINICIAN_LABEL.test(blob) && !PATIENT_LABEL.test(blob)) {
    return { dataSource: 'clinician_profile', filledBy: 'clinician' };
  }

  if (RECORD_LABEL.test(blob)) {
    return { dataSource: 'patient_record', filledBy: 'patient' };
  }

  if (SUMMARY_LABEL.test(blob)) {
    return { dataSource: 'patient_summary', filledBy: 'clinician' };
  }

  if (PATIENT_LABEL.test(blob)) {
    return { dataSource: 'patient_record', filledBy: 'patient' };
  }

  return { dataSource: 'none', filledBy: 'clinician' };
}

export function inferFieldSemantics(input: FieldInferenceInput): FieldInferenceResult {
  const fieldType = inferFieldType(input);
  const { dataSource, filledBy } = inferFillMetadata(input);
  return {
    fieldType,
    dataSource,
    filledBy,
    fillReview: 'suggested',
  };
}

type JsonProp = Record<string, unknown>;

function readLayoutNumber(prop: JsonProp, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = prop[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  const layout = prop.layout;
  if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
    const lo = layout as JsonProp;
    for (const k of keys) {
      const v = lo[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

/** Apply type + x-* fill metadata to every property in a sidecar schema. */
export function enrichSchemaWithFieldInference(
  schema: Record<string, unknown>
): Record<string, unknown> {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return schema;
  }

  const nextProps: Record<string, JsonProp> = {};
  for (const [key, raw] of Object.entries(properties as Record<string, JsonProp>)) {
    if (!raw || typeof raw !== 'object') {
      nextProps[key] = raw as JsonProp;
      continue;
    }
    const title =
      typeof raw.title === 'string' && raw.title.trim()
        ? raw.title.trim()
        : typeof raw.label === 'string'
          ? raw.label.trim()
          : key;
    const inferred = inferFieldSemantics({
      key,
      title,
      width: readLayoutNumber(raw, ['width', 'w']),
      height: readLayoutNumber(raw, ['height', 'h']),
      type: typeof raw.type === 'string' ? raw.type : undefined,
      format: typeof raw.format === 'string' ? raw.format : undefined,
    });

    const prop: JsonProp = { ...raw };
    if (inferred.fieldType === 'checkbox') {
      prop.type = 'boolean';
      delete prop.format;
    } else if (inferred.fieldType === 'number') {
      prop.type = 'integer';
      delete prop.format;
    } else {
      prop.type = 'string';
      if (inferred.fieldType === 'date') prop.format = 'date';
      else delete prop.format;
    }
    prop['x-data-source'] = inferred.dataSource;
    prop['x-filled-by'] = inferred.filledBy;
    prop['x-fill-review'] = inferred.fillReview;

    nextProps[key] = prop;
  }

  return { ...schema, properties: nextProps };
}

export function schemaHasUnconfirmedFillReview(schema: Record<string, unknown> | null): string[] {
  if (!schema?.properties || typeof schema.properties !== 'object') return [];
  const properties = schema.properties as Record<string, JsonProp>;
  const unconfirmed: string[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    if (!prop || typeof prop !== 'object') continue;
    const hasLayout =
      readLayoutNumber(prop, ['x', 'left', 'y', 'top']) !== undefined ||
      prop['x-page'] !== undefined;
    if (!hasLayout) continue;
    if (prop['x-fill-review'] !== 'confirmed') {
      const title = typeof prop.title === 'string' ? prop.title : key;
      unconfirmed.push(title);
    }
  }
  return unconfirmed;
}
