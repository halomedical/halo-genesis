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

/** Append manually entered form fields to patient summary markdown (in memory). */
export function appendFormDataToMarkdown(
  markdownText: string,
  newlyAddedData: Record<string, unknown>,
  schemaFields?: PdfSchemaFieldDescriptor[]
): string {
  if (!newlyAddedData || Object.keys(newlyAddedData).length === 0) {
    return markdownText;
  }

  const lines: string[] = [];
  for (const [fieldId, raw] of Object.entries(newlyAddedData)) {
    const text = formatValue(raw);
    if (!text) continue;
    lines.push(`- **${labelForField(fieldId, schemaFields)}**: ${text}`);
  }
  if (lines.length === 0) return markdownText;

  const base = (markdownText || '').trimEnd();
  const block = ['', '## New Form Data Added', ...lines].join('\n');
  if (!base) return block.trimStart();
  return base + block;
}
