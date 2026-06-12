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
  properties[params.key] = prop;
  return { ...schema, properties };
}

export function updateFieldMeta(
  schema: Record<string, unknown>,
  oldKey: string,
  params: { key: string; title: string; fieldType: FieldEditorType }
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
): { key: string; title: string; fieldType: FieldEditorType } {
  const title = typeof prop.title === 'string' && prop.title.trim() ? prop.title : key;
  if (prop.type === 'boolean') {
    return { key, title, fieldType: 'checkbox' };
  }
  if (prop.type === 'integer' || prop.type === 'number') {
    return { key, title, fieldType: 'number' };
  }
  if (prop.format === 'date') {
    return { key, title, fieldType: 'date' };
  }
  return { key, title, fieldType: 'text' };
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
