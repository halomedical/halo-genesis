import type { PdfSchemaFieldDescriptor } from './pdfSchemaUtils';

function labelForField(fieldId: string, schemaFields: PdfSchemaFieldDescriptor[] | undefined): string {
  const match = schemaFields?.find((f) => f.id === fieldId);
  if (match?.title?.trim()) return match.title.trim();
  return fieldId;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value).trim();
}

export function formDataLinesFromRecord(
  newlyAddedData: Record<string, unknown>,
  schemaFields?: PdfSchemaFieldDescriptor[]
): string[] {
  const lines: string[] = [];
  for (const [fieldId, raw] of Object.entries(newlyAddedData)) {
    const text = formatValue(raw);
    if (!text) continue;
    lines.push(`- **${labelForField(fieldId, schemaFields)}**: ${text}`);
  }
  return lines;
}

/** Append manually entered form fields to patient summary markdown (in memory). */
export function appendFormDataToMarkdown(
  markdownText: string,
  newlyAddedData: Record<string, unknown>,
  schemaFields?: PdfSchemaFieldDescriptor[],
  options?: { templateName?: string; savedAt?: string }
): string {
  if (!newlyAddedData || Object.keys(newlyAddedData).length === 0) {
    return markdownText;
  }

  const lines = formDataLinesFromRecord(newlyAddedData, schemaFields);
  if (lines.length === 0) return markdownText;

  const dateLabel = options?.savedAt
    ? options.savedAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const subsection =
    options?.templateName?.trim()
      ? `### ${options.templateName.trim()} — ${dateLabel}`
      : `### ${dateLabel}`;

  const base = (markdownText || '').trimEnd();
  const block = ['', '## New Form Data Added', subsection, ...lines].join('\n');
  if (!base) return block.trimStart();
  return base + block;
}
