import type {
  PdfFieldDataSource,
  PdfFieldFilledBy,
  PdfFillReview,
} from '../../../../../../../shared/pdfFieldInference';
import { inferFieldSemantics } from '../../../../../../../shared/pdfFieldInference';

export interface LayoutField {
  key: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

type JsonSchemaProperty = Record<string, unknown>;

const LAYOUT_KEYS = ['x-page', 'x_page', 'page'] as const;
const X_KEYS = ['x', 'left'] as const;
const Y_KEYS = ['y', 'top'] as const;
const W_KEYS = ['width', 'w'] as const;
const H_KEYS = ['height', 'h'] as const;

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readNumber(prop: JsonSchemaProperty, keys: readonly string[], fallback: number): number {
  for (const key of keys) {
    const n = asFiniteNumber(prop[key]);
    if (n !== null) return n;
  }
  const layout = prop.layout;
  if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
    const layoutObj = layout as JsonSchemaProperty;
    for (const key of keys) {
      const n = asFiniteNumber(layoutObj[key]);
      if (n !== null) return n;
    }
  }
  return fallback;
}

function readPage(prop: JsonSchemaProperty): number {
  for (const key of LAYOUT_KEYS) {
    const n = asFiniteNumber(prop[key]);
    if (n !== null) return Math.max(1, Math.round(n));
  }
  const layout = prop.layout;
  if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
    const layoutObj = layout as JsonSchemaProperty;
    for (const key of LAYOUT_KEYS) {
      const n = asFiniteNumber(layoutObj[key]);
      if (n !== null) return Math.max(1, Math.round(n));
    }
  }
  return 1;
}

function hasNumericLayout(prop: JsonSchemaProperty): boolean {
  const keys = [...LAYOUT_KEYS, ...X_KEYS, ...Y_KEYS, ...W_KEYS, ...H_KEYS];
  if (keys.some((k) => asFiniteNumber(prop[k]) !== null)) return true;
  const layout = prop.layout;
  if (layout && typeof layout === 'object' && !Array.isArray(layout)) {
    const layoutObj = layout as JsonSchemaProperty;
    return keys.some((k) => asFiniteNumber(layoutObj[k]) !== null);
  }
  return false;
}

function fieldFromProperty(key: string, prop: JsonSchemaProperty): LayoutField | null {
  if (!hasNumericLayout(prop)) return null;

  const title = prop.title;
  const label = typeof title === 'string' && title.trim() ? title : key;

  return {
    key,
    page: readPage(prop),
    x: readNumber(prop, X_KEYS, 0),
    y: readNumber(prop, Y_KEYS, 0),
    width: Math.max(readNumber(prop, W_KEYS, 80), 8),
    height: Math.max(readNumber(prop, H_KEYS, 18), 8),
    label,
  };
}

export function layoutFieldsFromSchema(schema: Record<string, unknown> | null): LayoutField[] {
  if (!schema) return [];
  const properties = (schema.properties || {}) as Record<string, JsonSchemaProperty>;
  const fields: LayoutField[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    const field = fieldFromProperty(key, prop);
    if (field) fields.push(field);
  }
  return fields.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

/** Schema property keys that have no numeric layout on the PDF (questionnaire-only). */
export function schemaKeysWithoutLayout(schema: Record<string, unknown> | null): string[] {
  if (!schema) return [];
  const properties = (schema.properties || {}) as Record<string, JsonSchemaProperty>;
  const placed = new Set(layoutFieldsFromSchema(schema).map((f) => f.key));
  return Object.keys(properties).filter((k) => !placed.has(k));
}

export function subsetSchemaForKeys(
  schema: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const properties = (schema.properties || {}) as Record<string, JsonSchemaProperty>;
  const subset: Record<string, JsonSchemaProperty> = {};
  for (const key of keys) {
    if (properties[key]) subset[key] = properties[key];
  }
  return { ...schema, properties: subset };
}

export function fieldsOnPage(fields: LayoutField[], page: number): LayoutField[] {
  return fields.filter((f) => f.page === page);
}

export function applyLayoutToSchema(
  schema: Record<string, unknown>,
  key: string,
  patch: Partial<Pick<LayoutField, 'page' | 'x' | 'y' | 'width' | 'height'>>
): Record<string, unknown> {
  const properties = { ...((schema.properties || {}) as Record<string, JsonSchemaProperty>) };
  const existing = { ...(properties[key] || {}) };

  if (patch.page !== undefined) existing['x-page'] = patch.page;
  if (patch.x !== undefined) existing.x = patch.x;
  if (patch.y !== undefined) existing.y = patch.y;
  if (patch.width !== undefined) existing.width = patch.width;
  if (patch.height !== undefined) existing.height = patch.height;

  properties[key] = existing;
  return { ...schema, properties };
}

export type FieldEditorType = 'text' | 'date' | 'checkbox' | 'number';

export const FIELD_TYPE_BOX_CLASSES: Record<
  FieldEditorType,
  { idle: string; selected: string }
> = {
  text: {
    idle: 'bg-indigo-500/10 border-indigo-500/45 text-indigo-800',
    selected: 'bg-indigo-500/20 border-indigo-600 ring-1 ring-indigo-500/50 text-indigo-900',
  },
  date: {
    idle: 'bg-sky-500/10 border-sky-500/45 text-sky-900',
    selected: 'bg-sky-500/20 border-sky-600 ring-1 ring-sky-500/50 text-sky-950',
  },
  checkbox: {
    idle: 'bg-amber-500/10 border-amber-500/45 text-amber-900',
    selected: 'bg-amber-500/20 border-amber-600 ring-1 ring-amber-500/50 text-amber-950',
  },
  number: {
    idle: 'bg-emerald-500/10 border-emerald-500/45 text-emerald-900',
    selected: 'bg-emerald-500/20 border-emerald-600 ring-1 ring-emerald-500/50 text-emerald-950',
  },
};

export function slugFromLabel(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  return base || 'field';
}

export function uniqueFieldKey(
  schema: Record<string, unknown>,
  preferred: string,
  excludeKey?: string
): string {
  const properties = (schema.properties || {}) as Record<string, unknown>;
  let key = slugFromLabel(preferred);
  if (!properties[key] || key === excludeKey) return key;
  let n = 2;
  while (properties[`${key}_${n}`]) n += 1;
  return `${key}_${n}`;
}

export function cloneSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
}

export function addFieldToSchema(
  schema: Record<string, unknown>,
  params: {
    key: string;
    title: string;
    fieldType: FieldEditorType;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    dataSource?: PdfFieldDataSource;
    filledBy?: PdfFieldFilledBy;
    fillReview?: PdfFillReview;
  }
): Record<string, unknown> {
  const properties = { ...((schema.properties || {}) as Record<string, JsonSchemaProperty>) };
  const prop: JsonSchemaProperty = {
    type:
      params.fieldType === 'checkbox'
        ? 'boolean'
        : params.fieldType === 'number'
          ? 'integer'
          : 'string',
    title: params.title,
    x: params.x,
    y: params.y,
    width: Math.max(params.width, 8),
    height: Math.max(params.height, 8),
    'x-page': params.page,
  };
  if (params.fieldType === 'date') {
    prop.format = 'date';
  }
  const inferred = inferFieldSemantics({
    key: params.key,
    title: params.title,
    width: params.width,
    height: params.height,
    type: String(prop.type),
    format: typeof prop.format === 'string' ? prop.format : undefined,
  });
  prop['x-data-source'] = params.dataSource ?? inferred.dataSource;
  prop['x-filled-by'] = params.filledBy ?? inferred.filledBy;
  prop['x-fill-review'] = params.fillReview ?? 'suggested';
  properties[params.key] = prop;
  return { ...schema, properties };
}

export function updateFieldMeta(
  schema: Record<string, unknown>,
  oldKey: string,
  params: {
    key: string;
    title: string;
    fieldType: FieldEditorType;
    dataSource: PdfFieldDataSource;
    filledBy: PdfFieldFilledBy;
  }
): Record<string, unknown> {
  const properties = { ...((schema.properties || {}) as Record<string, JsonSchemaProperty>) };
  const existing = { ...(properties[oldKey] || {}) };
  if (!properties[oldKey]) return schema;

  delete properties[oldKey];
  const prop: JsonSchemaProperty = {
    ...existing,
    title: params.title,
    type:
      params.fieldType === 'checkbox'
        ? 'boolean'
        : params.fieldType === 'number'
          ? 'integer'
          : 'string',
  };
  if (params.fieldType === 'date') {
    prop.format = 'date';
    delete prop.default;
  } else if (params.fieldType === 'checkbox') {
    delete prop.format;
  } else {
    delete prop.format;
  }
  prop['x-data-source'] = params.dataSource;
  prop['x-filled-by'] = params.filledBy;
  prop['x-fill-review'] = 'confirmed';
  properties[params.key] = prop;
  return { ...schema, properties };
}

export function removeFieldsFromSchema(
  schema: Record<string, unknown>,
  keys: string[]
): Record<string, unknown> {
  const properties = { ...((schema.properties || {}) as Record<string, JsonSchemaProperty>) };
  for (const key of keys) delete properties[key];
  return { ...schema, properties };
}

export function applyLayoutDeltaToSchema(
  schema: Record<string, unknown>,
  keys: string[],
  delta: { dx: number; dy: number }
): Record<string, unknown> {
  let next = schema;
  for (const key of keys) {
    const properties = (next.properties || {}) as Record<string, JsonSchemaProperty>;
    const prop = properties[key];
    if (!prop) continue;
    const x = readNumber(prop, X_KEYS, 0) + delta.dx;
    const y = readNumber(prop, Y_KEYS, 0) + delta.dy;
    next = applyLayoutToSchema(next, key, { x, y });
  }
  return next;
}

export function applyLayoutsToSchema(
  schema: Record<string, unknown>,
  updates: Array<{ key: string; patch: Partial<Pick<LayoutField, 'page' | 'x' | 'y' | 'width' | 'height'>> }>
): Record<string, unknown> {
  let next = schema;
  for (const { key, patch } of updates) {
    next = applyLayoutToSchema(next, key, patch);
  }
  return next;
}

export function fieldMetaFromProperty(
  key: string,
  prop: JsonSchemaProperty
): {
  key: string;
  title: string;
  fieldType: FieldEditorType;
  dataSource: PdfFieldDataSource;
  filledBy: PdfFieldFilledBy;
  fillReview: PdfFillReview;
} {
  const title = typeof prop.title === 'string' && prop.title.trim() ? prop.title : key;
  let fieldType: FieldEditorType = 'text';
  if (prop.type === 'boolean') {
    fieldType = 'checkbox';
  } else if (prop.type === 'integer' || prop.type === 'number') {
    fieldType = 'number';
  } else if (prop.format === 'date') {
    fieldType = 'date';
  }
  const dataSource = prop['x-data-source'] as PdfFieldDataSource | undefined;
  const filledBy = prop['x-filled-by'] as PdfFieldFilledBy | undefined;
  const fillReview = prop['x-fill-review'] as PdfFillReview | undefined;
  return {
    key,
    title,
    fieldType,
    dataSource: dataSource ?? 'none',
    filledBy: filledBy ?? 'clinician',
    fillReview: fillReview ?? 'suggested',
  };
}

const CANVAS_PAD_PT = 24;
/** Limit how far off-page boxes can expand the studio canvas (bad coords stay scrollable but bounded). */
const MAX_OVERFLOW_PT = 180;

export function pageCanvasBounds(
  pageFields: LayoutField[],
  pageWidth: number,
  pageHeight: number
): { minX: number; minY: number; width: number; height: number; pageOffsetX: number; pageOffsetY: number } {
  let minX = 0;
  let minY = 0;
  let maxX = pageWidth;
  let maxY = pageHeight;
  for (const f of pageFields) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.width);
    maxY = Math.max(maxY, f.y + f.height);
  }
  minX = Math.max(minX, -MAX_OVERFLOW_PT);
  minY = Math.max(minY, -MAX_OVERFLOW_PT);
  maxX = Math.min(maxX, pageWidth + MAX_OVERFLOW_PT);
  maxY = Math.min(maxY, pageHeight + MAX_OVERFLOW_PT);
  minX -= CANVAS_PAD_PT;
  minY -= CANVAS_PAD_PT;
  maxX += CANVAS_PAD_PT;
  maxY += CANVAS_PAD_PT;
  const width = Math.max(maxX - minX, pageWidth);
  const height = Math.max(maxY - minY, pageHeight);
  return {
    minX,
    minY,
    width,
    height,
    pageOffsetX: -minX,
    pageOffsetY: -minY,
  };
}

export function initialFormDataFromSchema(schema: Record<string, unknown>): Record<string, string | boolean> {
  const properties = (schema.properties || {}) as Record<string, { type?: string; default?: unknown }>;
  const out: Record<string, string | boolean> = {};
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === 'boolean') {
      out[key] = Boolean(prop.default);
    } else {
      out[key] = typeof prop.default === 'string' ? prop.default : '';
    }
  }
  return out;
}

const DUPLICATE_GAP_PT = 6;

export function baseTitleForDuplicate(title: string): string {
  return title.replace(/\s+\d+$/, '').trim() || title;
}

export function nextNumberedDuplicateTitle(
  schema: Record<string, unknown>,
  baseTitle: string
): string {
  const properties = (schema.properties || {}) as Record<string, JsonSchemaProperty>;
  const base = baseTitleForDuplicate(baseTitle);
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`, 'i');
  let maxN = 0;
  for (const prop of Object.values(properties)) {
    const t = typeof prop.title === 'string' ? prop.title.trim() : '';
    if (!t) continue;
    const m = t.match(pattern);
    if (m) {
      const n = m[1] ? Number(m[1]) : 0;
      if (Number.isFinite(n)) maxN = Math.max(maxN, n);
    }
  }
  return `${base} ${maxN + 1}`;
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV';
export type DistributeMode = 'horizontal' | 'vertical';

export function duplicateFieldsInSchema(
  schema: Record<string, unknown>,
  keys: string[],
  layoutFields: LayoutField[]
): { schema: Record<string, unknown>; newKeys: string[] } {
  const fieldByKey = new Map(layoutFields.map((f) => [f.key, f]));
  const ordered = [...keys]
    .filter((k) => fieldByKey.has(k))
    .sort((a, b) => {
      const fa = fieldByKey.get(a)!;
      const fb = fieldByKey.get(b)!;
      return fa.y - fb.y || fa.x - fb.x;
    });
  if (ordered.length === 0) return { schema, newKeys: [] };

  let minX = Infinity;
  let minY = Infinity;
  let maxBottom = -Infinity;
  for (const k of ordered) {
    const f = fieldByKey.get(k)!;
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxBottom = Math.max(maxBottom, f.y + f.height);
  }
  const groupDy = maxBottom - minY + DUPLICATE_GAP_PT;

  let next = cloneSchema(schema);
  const properties = (next.properties || {}) as Record<string, JsonSchemaProperty>;
  const newKeys: string[] = [];

  for (const key of ordered) {
    const source = fieldByKey.get(key)!;
    const sourceProp = { ...(properties[key] || {}) };
    const baseTitle =
      typeof sourceProp.title === 'string' && sourceProp.title.trim()
        ? sourceProp.title
        : source.label;
    const title = nextNumberedDuplicateTitle(next, baseTitle);
    const newKey = uniqueFieldKey(next, title);
    const newY = source.y + groupDy;
    const newProp: JsonSchemaProperty = {
      ...sourceProp,
      title,
      x: source.x,
      y: newY,
    };
    properties[newKey] = newProp;
    next = { ...next, properties };
    newKeys.push(newKey);
  }

  return { schema: next, newKeys };
}

function selectionBounds(fields: LayoutField[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  centerX: number;
  centerY: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of fields) {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x + f.width);
    maxY = Math.max(maxY, f.y + f.height);
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

export function alignFieldsInSchema(
  schema: Record<string, unknown>,
  keys: string[],
  mode: AlignMode,
  layoutFields: LayoutField[]
): Record<string, unknown> {
  const fieldByKey = new Map(layoutFields.map((f) => [f.key, f]));
  const selected = keys.map((k) => fieldByKey.get(k)).filter((f): f is LayoutField => Boolean(f));
  if (selected.length < 2) return schema;
  const b = selectionBounds(selected);
  const updates: Array<{ key: string; patch: Partial<Pick<LayoutField, 'x' | 'y'>> }> = [];
  for (const f of selected) {
    let x = f.x;
    let y = f.y;
    switch (mode) {
      case 'left':
        x = b.minX;
        break;
      case 'right':
        x = b.maxX - f.width;
        break;
      case 'top':
        y = b.minY;
        break;
      case 'bottom':
        y = b.maxY - f.height;
        break;
      case 'centerH':
        x = b.centerX - f.width / 2;
        break;
      case 'centerV':
        y = b.centerY - f.height / 2;
        break;
      default:
        break;
    }
    updates.push({ key: f.key, patch: { x, y } });
  }
  return applyLayoutsToSchema(schema, updates);
}

export function distributeFieldsInSchema(
  schema: Record<string, unknown>,
  keys: string[],
  mode: DistributeMode,
  layoutFields: LayoutField[]
): Record<string, unknown> {
  const fieldByKey = new Map(layoutFields.map((f) => [f.key, f]));
  const selected = keys
    .map((k) => fieldByKey.get(k))
    .filter((f): f is LayoutField => Boolean(f));
  if (selected.length < 3) return schema;

  const updates: Array<{ key: string; patch: Partial<Pick<LayoutField, 'x' | 'y'>> }> = [];

  if (mode === 'horizontal') {
    const sorted = [...selected].sort((a, b) => a.x - b.x);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last.x - first.x;
    const step = span / (sorted.length - 1);
    sorted.forEach((f, i) => {
      if (i === 0 || i === sorted.length - 1) return;
      updates.push({ key: f.key, patch: { x: first.x + step * i } });
    });
  } else {
    const sorted = [...selected].sort((a, b) => a.y - b.y);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = last.y - first.y;
    const step = span / (sorted.length - 1);
    sorted.forEach((f, i) => {
      if (i === 0 || i === sorted.length - 1) return;
      updates.push({ key: f.key, patch: { y: first.y + step * i } });
    });
  }

  return applyLayoutsToSchema(schema, updates);
}
