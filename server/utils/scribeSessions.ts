import type {
  JsonValue,
  NoteField,
  ScribeSession,
  ScribeSessionNote,
} from '../../shared/types';

function sanitizeJsonValue(value: unknown, depth = 0): JsonValue | undefined {
  if (depth > 8) return undefined;
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeJsonValue(item, depth + 1))
      .filter((item): item is JsonValue => item !== undefined);
  }

  if (typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeJsonValue(item, depth + 1);
      if (sanitized !== undefined) out[key] = sanitized;
    }
    return out;
  }

  return undefined;
}

function parseNoteFields(fieldsRaw: unknown): NoteField[] | undefined {
  if (!Array.isArray(fieldsRaw)) return undefined;

  const fields = fieldsRaw
    .slice(0, 100)
    .map((field: unknown) => {
      const obj = field && typeof field === 'object' ? (field as Record<string, unknown>) : {};
      const label = typeof obj.label === 'string' ? obj.label.slice(0, 300) : '';
      const body = typeof obj.body === 'string' ? obj.body.slice(0, 20000) : '';
      if (!label && !body) return null;
      return { label, body };
    })
    .filter((field): field is NoteField => field !== null);

  return fields.length > 0 ? fields : undefined;
}

export function parseSessionNotes(notesRaw: unknown): ScribeSessionNote[] | undefined {
  if (!Array.isArray(notesRaw)) return undefined;

  const notes = notesRaw
    .slice(0, 20)
    .map((n: unknown) => {
      const o = n && typeof n === 'object' ? (n as Record<string, unknown>) : {};
      const fields = parseNoteFields(o.fields);
      const rawData = sanitizeJsonValue(o.rawData);
      return {
        noteId: String(o.noteId ?? ''),
        title: String(o.title ?? ''),
        content: String(o.content ?? '').slice(0, 100000),
        template_id: String(o.template_id ?? ''),
        ...(fields ? { fields } : {}),
        ...(rawData !== undefined ? { rawData } : {}),
      };
    })
    .filter((note) => note.noteId || note.title || note.content || note.template_id);

  return notes.length > 0 ? notes : undefined;
}

export function parseSessionsJson(raw: unknown): ScribeSession[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .map((item): ScribeSession | null => {
      const obj = item as Partial<ScribeSession> & { notes?: unknown[] };
      if (!obj || typeof obj !== 'object') return null;
      if (
        typeof obj.id !== 'string' ||
        typeof obj.patientId !== 'string' ||
        typeof obj.createdAt !== 'string' ||
        typeof obj.transcript !== 'string'
      ) {
        return null;
      }
      const notes = parseSessionNotes(obj.notes);
      return {
        id: obj.id,
        patientId: obj.patientId,
        createdAt: obj.createdAt,
        transcript: obj.transcript,
        context: typeof obj.context === 'string' ? obj.context : undefined,
        templates: Array.isArray(obj.templates) ? obj.templates.map(String) : undefined,
        noteTitles: Array.isArray(obj.noteTitles) ? obj.noteTitles.map(String) : undefined,
        notes,
        mainComplaint:
          typeof obj.mainComplaint === 'string'
            ? obj.mainComplaint.trim().slice(0, 200)
            : undefined,
      } as ScribeSession;
    })
    .filter((session): session is ScribeSession => session !== null);
}
