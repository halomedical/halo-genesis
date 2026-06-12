function valueForCompare(value: string | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : '';
  return value.trim();
}

/** Fields the user filled or changed relative to a baseline (for summary enrichment). */
export function findManuallyTypedFields(
  baseline: Record<string, string | boolean | null | undefined> | null | undefined,
  finalValues: Record<string, string | boolean>
): Record<string, string | boolean> {
  if (!baseline) return {};

  const out: Record<string, string | boolean> = {};
  for (const [key, finalVal] of Object.entries(finalValues)) {
    const finalStr = valueForCompare(finalVal);
    if (!finalStr && finalVal !== false) continue;

    const baseStr = valueForCompare(baseline[key]);
    if (!baseStr && finalStr) {
      out[key] = finalVal;
      continue;
    }
    if (baseStr && finalStr && finalStr !== baseStr) {
      out[key] = finalVal;
    }
  }
  return out;
}

/** Union of human edits vs chart prefill baseline and vs autofill baseline. */
export function mergeHumanFieldDeltas(
  initialBaseline: Record<string, string | boolean> | null | undefined,
  autofillBaseline: Record<string, string | boolean | null | undefined> | null | undefined,
  finalValues: Record<string, string | boolean>
): Record<string, string | boolean> {
  const out = { ...findManuallyTypedFields(initialBaseline, finalValues) };
  if (autofillBaseline) {
    for (const [key, val] of Object.entries(findManuallyTypedFields(autofillBaseline, finalValues))) {
      out[key] = val;
    }
  }
  return out;
}
