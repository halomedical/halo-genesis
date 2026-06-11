const LAYOUT_EPS = 0.5;

export type FieldSnapshot = {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  type: string;
  format?: string;
  page: number;
};

export type FieldChangeType = 'create' | 'delete' | 'move' | 'resize' | 'meta';

export interface FieldChangeRecord {
  field_key: string;
  change_type: FieldChangeType;
  page: number;
  before: FieldSnapshot | null;
  after: FieldSnapshot | null;
}

export interface LayoutCorrectionSummary {
  added: number;
  removed: number;
  moved: number;
  resized: number;
  meta_changed: number;
}

function asNum(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function snapshotFromProp(key: string, prop: Record<string, unknown>): FieldSnapshot {
  const title = typeof prop.title === 'string' && prop.title.trim() ? prop.title : key;
  const type = typeof prop.type === 'string' ? prop.type : 'string';
  const format = typeof prop.format === 'string' ? prop.format : undefined;
  const page = Math.max(1, Math.round(asNum(prop['x-page'] ?? prop.page, 1)));
  return {
    x: asNum(prop.x, 0),
    y: asNum(prop.y, 0),
    width: asNum(prop.width, 80),
    height: asNum(prop.height, 18),
    title,
    type,
    format,
    page,
  };
}

function metaEqual(a: FieldSnapshot, b: FieldSnapshot): boolean {
  return a.title === b.title && a.type === b.type && (a.format ?? '') === (b.format ?? '');
}

function layoutEqual(a: FieldSnapshot, b: FieldSnapshot): boolean {
  return (
    Math.abs(a.x - b.x) < LAYOUT_EPS &&
    Math.abs(a.y - b.y) < LAYOUT_EPS &&
    Math.abs(a.width - b.width) < LAYOUT_EPS &&
    Math.abs(a.height - b.height) < LAYOUT_EPS &&
    a.page === b.page
  );
}

function positionEqual(a: FieldSnapshot, b: FieldSnapshot): boolean {
  return (
    Math.abs(a.x - b.x) < LAYOUT_EPS &&
    Math.abs(a.y - b.y) < LAYOUT_EPS &&
    a.page === b.page
  );
}

function sizeEqual(a: FieldSnapshot, b: FieldSnapshot): boolean {
  return Math.abs(a.width - b.width) < LAYOUT_EPS && Math.abs(a.height - b.height) < LAYOUT_EPS;
}

export function diffLayoutSchemas(
  baseline: Record<string, unknown> | null | undefined,
  finalSchema: Record<string, unknown>
): { field_changes: FieldChangeRecord[]; summary: LayoutCorrectionSummary } {
  const summary: LayoutCorrectionSummary = {
    added: 0,
    removed: 0,
    moved: 0,
    resized: 0,
    meta_changed: 0,
  };
  const field_changes: FieldChangeRecord[] = [];

  const baseProps = ((baseline?.properties ?? {}) as Record<string, Record<string, unknown>>) || {};
  const finalProps = (finalSchema.properties ?? {}) as Record<string, Record<string, unknown>>;

  const allKeys = new Set([...Object.keys(baseProps), ...Object.keys(finalProps)]);

  for (const key of allKeys) {
    const beforeProp = baseProps[key];
    const afterProp = finalProps[key];
    const before = beforeProp ? snapshotFromProp(key, beforeProp) : null;
    const after = afterProp ? snapshotFromProp(key, afterProp) : null;

    if (!before && after) {
      summary.added += 1;
      field_changes.push({
        field_key: key,
        change_type: 'create',
        page: after.page,
        before: null,
        after,
      });
      continue;
    }
    if (before && !after) {
      summary.removed += 1;
      field_changes.push({
        field_key: key,
        change_type: 'delete',
        page: before.page,
        before,
        after: null,
      });
      continue;
    }
    if (!before || !after) continue;

    const types: FieldChangeType[] = [];
    if (!positionEqual(before, after)) types.push('move');
    if (!sizeEqual(before, after)) types.push('resize');
    if (!metaEqual(before, after)) types.push('meta');

    if (types.length === 0) continue;

    if (types.includes('move')) summary.moved += 1;
    if (types.includes('resize')) summary.resized += 1;
    if (types.includes('meta')) summary.meta_changed += 1;

    const change_type: FieldChangeType =
      types.includes('move') ? 'move' : types.includes('resize') ? 'resize' : 'meta';

    field_changes.push({
      field_key: key,
      change_type,
      page: after.page,
      before,
      after,
    });
  }

  return { field_changes, summary };
}
