import React, { useEffect, useMemo, useState } from 'react';
import {
  CloudOff,
  Eye,
  FileDown,
  Loader2,
  Mail,
  PencilLine,
  RefreshCw,
  Save,
} from 'lucide-react';
import type { HaloNote, NoteField } from '../../../../shared/types';
import { AppStatus } from '../../../../shared/types';

function fieldsToContent(fields: NoteField[]): string {
  return fields
    .map((field) => (field.label ? `${field.label}:\n${field.body ?? ''}` : field.body))
    .filter(Boolean)
    .join('\n\n');
}

function getEditableNoteText(note: HaloNote): string {
  if (note.fields?.length) return fieldsToContent(note.fields);
  return note.content ?? '';
}

function buildPreviewSignature(note: HaloNote): string {
  return JSON.stringify({
    title: note.title,
    templateId: note.template_id,
    text: getEditableNoteText(note),
  });
}

interface NoteEditorProps {
  notes: HaloNote[];
  activeIndex: number;
  onNoteChange: (noteIndex: number, updates: { title?: string; content?: string; fields?: NoteField[] }) => void;
  status: AppStatus;
  onSaveAsDocx: (noteIndex: number) => void;
  onSave: () => void;
  onEmail: (noteIndex: number) => void;
  onLoadPreview: (noteIndex: number, force?: boolean) => Promise<void> | void;
  savingNoteIndex: number | null;
  previewUrls: Record<string, string>;
  previewErrors: Record<string, string>;
  previewSignatures: Record<string, string>;
  previewLoadingNoteId: string | null;
  viewModes: Record<string, 'edit' | 'preview'>;
  onViewModeChange: (noteId: string, mode: 'edit' | 'preview') => void;
}

export const NoteEditor: React.FC<NoteEditorProps> = ({
  notes,
  activeIndex,
  onNoteChange,
  status,
  onSaveAsDocx,
  onSave,
  onEmail,
  onLoadPreview,
  savingNoteIndex,
  previewUrls,
  previewErrors,
  previewSignatures,
  previewLoadingNoteId,
  viewModes,
  onViewModeChange,
}) => {
  const activeNote = notes[activeIndex];
  const [autosaveMsg, setAutosaveMsg] = useState<string | null>(null);
  const busy = status === AppStatus.FILING || status === AppStatus.SAVING;
  const activeFields = activeNote?.fields ?? [];
  const activeViewMode = activeNote ? viewModes[activeNote.noteId] ?? 'preview' : 'preview';
  const activePreviewUrl = activeNote ? previewUrls[activeNote.noteId] : undefined;
  const activePreviewError = activeNote ? previewErrors[activeNote.noteId] : undefined;
  const activePreviewSignature = activeNote ? previewSignatures[activeNote.noteId] : undefined;

  useEffect(() => {
    if (!activeNote?.lastSavedAt || activeNote.dirty) return;
    const saved = new Date(activeNote.lastSavedAt);
    const diffMs = Date.now() - saved.getTime();
    if (diffMs < 5000) {
      setAutosaveMsg('Autosaved');
      const timeoutId = setTimeout(() => setAutosaveMsg(null), 2800);
      return () => clearTimeout(timeoutId);
    }
  }, [activeNote?.dirty, activeNote?.lastSavedAt]);

  const displayContent = useMemo(() => {
    if (!activeNote) return '';
    return getEditableNoteText(activeNote);
  }, [activeNote]);
  const activeSignature = activeNote ? buildPreviewSignature(activeNote) : '';
  const previewIsStale = Boolean(
    activeNote && activePreviewSignature && activePreviewSignature !== activeSignature
  );
  const isPreviewLoading = Boolean(
    activeNote && previewLoadingNoteId === activeNote.noteId
  );

  useEffect(() => {
    if (!activeNote || !displayContent.trim() || isPreviewLoading) return;
    if (activePreviewUrl || activePreviewSignature) return;
    void onLoadPreview(activeIndex);
  }, [
    activeIndex,
    activeNote,
    activePreviewSignature,
    activePreviewUrl,
    displayContent,
    isPreviewLoading,
    onLoadPreview,
  ]);

  if (!activeNote) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6 py-10 text-center">
        <p className="text-sm text-slate-400">
          No notes yet. Record a consultation to generate structured notes here.
        </p>
      </div>
    );
  }

  useEffect(() => {
    if (!activeNote || activeViewMode !== 'preview' || !displayContent.trim()) return;
    const isFresh = Boolean(
      activePreviewUrl && activePreviewSignature === activeSignature
    );
    if (isFresh || isPreviewLoading) return;
    void onLoadPreview(activeIndex);
  }, [
    activeIndex,
    activeNote,
    activePreviewSignature,
    activePreviewUrl,
    activeSignature,
    activeViewMode,
    displayContent,
    isPreviewLoading,
    onLoadPreview,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[linear-gradient(180deg,#fbfdff_0%,#f5f9fc_100%)]">
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeViewMode === 'preview' ? (
          <div className="relative h-full min-h-0">
            {activePreviewUrl ? (
              <iframe
                key={activePreviewUrl}
                title={`${activeNote.title || 'Note'} PDF preview`}
                src={activePreviewUrl}
                className="h-full w-full border-0 bg-white"
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <div className="max-w-sm space-y-2">
                  {isPreviewLoading ? (
                    <>
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-sky-600" />
                      <p className="text-sm font-medium text-slate-700">
                        Building PDF preview…
                      </p>
                    </>
                  ) : (
                    <>
                      <Eye className="mx-auto h-6 w-6 text-slate-300" />
                      <p className="text-sm text-slate-500">
                        A PDF preview will appear here once the note is ready.
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {isPreviewLoading && activePreviewUrl && (
              <div className="absolute right-4 top-4 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
                Refreshing preview
              </div>
            )}

            {activePreviewError && (
              <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-rose-200 bg-white/95 px-4 py-3 text-sm text-rose-600 shadow-sm">
                {activePreviewError}
              </div>
            )}
          </div>
        ) : activeFields.length > 0 ? (
          <div className="h-full overflow-y-auto px-6 py-6 md:px-8">
            <div className="mx-auto w-full max-w-[1160px] divide-y divide-slate-200">
              {activeFields.map((field, fieldIndex) => {
                const rows = Math.max(
                  4,
                  Math.min(14, (field.body || '').split(/\r?\n/).length + 1)
                );
                return (
                  <section
                    key={`${activeNote.noteId}-${field.label}-${fieldIndex}`}
                    className="py-6 first:pt-0 last:pb-0"
                  >
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                      {field.label || `Section ${fieldIndex + 1}`}
                    </div>
                    <textarea
                      value={field.body}
                      onChange={(e) => {
                        const nextFields = activeFields.map((currentField, index) =>
                          index === fieldIndex
                            ? { ...currentField, body: e.target.value }
                            : currentField
                        );
                        onNoteChange(activeIndex, { fields: nextFields });
                      }}
                      rows={rows}
                      className="w-full resize-y border-0 bg-transparent p-0 text-sm leading-7 text-slate-700 outline-none placeholder:text-slate-400"
                      placeholder={`Add ${field.label || `section ${fieldIndex + 1}`} details…`}
                    />
                  </section>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto px-6 py-6 md:px-8">
            <div className="mx-auto w-full max-w-[1160px]">
              <textarea
                value={displayContent}
                onChange={(e) => onNoteChange(activeIndex, { content: e.target.value })}
                placeholder="Your generated note will appear here."
                className="min-h-[420px] w-full resize-none border-0 bg-transparent p-0 text-sm leading-7 text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-200 bg-white/96 px-4 py-3 backdrop-blur-sm md:px-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onSaveAsDocx(activeIndex)}
                disabled={busy || !displayContent.trim()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-sky-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingNoteIndex === activeIndex ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileDown className="h-4 w-4" />
                )}
                Save as .docx
              </button>
              <button
                type="button"
                onClick={() => onEmail(activeIndex)}
                disabled={busy || !displayContent.trim()}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingNoteIndex === activeIndex && status === AppStatus.SAVING ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="h-4 w-4" />
                )}
                Email
              </button>
              <button
                type="button"
                onClick={onSave}
                disabled={busy}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {status === AppStatus.SAVING && savingNoteIndex === null ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => onViewModeChange(activeNote.noteId, 'edit')}
                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
                    activeViewMode === 'edit'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => onViewModeChange(activeNote.noteId, 'preview')}
                  className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition ${
                    activeViewMode === 'preview'
                      ? 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </button>
              </div>
              <button
                type="button"
                onClick={() => void onLoadPreview(activeIndex, true)}
                disabled={isPreviewLoading || !displayContent.trim()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPreviewLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Regenerate
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              {previewIsStale && (
                <span className="font-medium text-amber-600">
                  Preview needs refresh
                </span>
              )}
              {activeNote.dirty && (
                <span className="flex items-center gap-1 font-medium text-amber-600">
                  <CloudOff className="h-3.5 w-3.5" />
                  Unsaved changes
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 text-slate-400">
              {autosaveMsg && !activeNote.dirty && (
                <span className="font-medium text-sky-600">✓ {autosaveMsg}</span>
              )}
              {!activeNote.dirty && !autosaveMsg && activeNote.lastSavedAt && (
                <span>
                  Saved{' '}
                  {new Date(activeNote.lastSavedAt).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
