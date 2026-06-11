import React from 'react';
import { Loader2, Plus, Save, SquareDashedMousePointer, Trash2 } from 'lucide-react';
import { PdfDropzone } from './PdfDropzone';
import { FieldEditorPanel, type PendingFieldRect } from './FieldEditorPanel';
import {
  fieldsOnPage,
  FIELD_TYPE_BOX_CLASSES,
  type FieldEditorType,
  type LayoutField,
} from '../utils/schemaLayout';
import type { StudioCanvasMode } from '../state/useFormIntelligenceState';
import {
  PDF_DOCUMENT_TYPES,
  PDF_DOCUMENT_TYPE_LABELS,
  type PdfDocumentType,
} from '../../../../../../../shared/pdfFiller';

interface StudioSidebarProps {
  uploadedFile: File | null;
  extracting: boolean;
  extractError: string | null;
  pdfHash: string;
  cacheHit: boolean | null;
  extractionMethod: string;
  currentPage: number;
  fields: LayoutField[];
  selectedFieldKeys: string[];
  primaryFieldKey: string | null;
  canvasMode: StudioCanvasMode;
  pendingDrawRect: PendingFieldRect | null;
  editorOpen: boolean;
  onSelectFields: (keys: string[], primary?: string | null, toggle?: boolean) => void;
  onCanvasModeChange: (mode: StudioCanvasMode) => void;
  onFile: (file: File) => void;
  documentType: PdfDocumentType;
  displayName: string;
  onDocumentTypeChange: (type: PdfDocumentType) => void;
  onDisplayNameChange: (name: string) => void;
  practiceTemplateId?: string;
  saving: boolean;
  onSaveTemplate: () => void;
  canSave: boolean;
  onNudge: (dx: number, dy: number) => void;
  onDeleteSelected: () => void;
  onPendingFieldSave: (params: { title: string; key: string; fieldType: FieldEditorType }) => void;
  onPendingFieldCancel: () => void;
  onEditFieldSave: (params: { title: string; key: string; fieldType: FieldEditorType }) => void;
  onEditFieldCancel: () => void;
  onOpenFieldEditor: () => void;
  getFieldMeta: (key: string) => { key: string; title: string; fieldType: FieldEditorType } | null;
}

export const StudioSidebar: React.FC<StudioSidebarProps> = ({
  uploadedFile,
  extracting,
  extractError,
  pdfHash,
  cacheHit,
  extractionMethod,
  currentPage,
  fields,
  selectedFieldKeys,
  primaryFieldKey,
  canvasMode,
  pendingDrawRect,
  editorOpen,
  onSelectFields,
  onCanvasModeChange,
  onFile,
  documentType,
  displayName,
  onDocumentTypeChange,
  onDisplayNameChange,
  practiceTemplateId,
  saving,
  onSaveTemplate,
  canSave,
  onNudge,
  onDeleteSelected,
  onPendingFieldSave,
  onPendingFieldCancel,
  onEditFieldSave,
  onEditFieldCancel,
  onOpenFieldEditor,
  getFieldMeta,
}) => {
  const pageFields = fieldsOnPage(fields, currentPage);
  const selectedSet = new Set(selectedFieldKeys);
  const editMeta = primaryFieldKey && !pendingDrawRect ? getFieldMeta(primaryFieldKey) : null;

  return (
    <div className="flex flex-col gap-4 p-5 overflow-y-auto h-full">
      <PdfDropzone onFile={onFile} loading={extracting} />

      {extractError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {extractError}
        </div>
      )}

      {uploadedFile && !extracting && pdfHash && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onCanvasModeChange(canvasMode === 'draw' ? 'select' : 'draw')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border ${
              canvasMode === 'draw'
                ? 'bg-emerald-600 text-white border-emerald-600'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <SquareDashedMousePointer className="h-3.5 w-3.5" />
            {canvasMode === 'draw' ? 'Drawing…' : 'Add field'}
          </button>
          {selectedFieldKeys.length > 0 && (
            <button
              type="button"
              onClick={onDeleteSelected}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border border-red-200 text-red-700 bg-white hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </button>
          )}
        </div>
      )}

      {selectedFieldKeys.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-medium">{selectedFieldKeys.length} selected</span>
          <span className="text-slate-400">Nudge:</span>
          <button type="button" className="px-2 py-1 rounded border border-slate-200 bg-white" onClick={() => onNudge(-2, 0)}>←</button>
          <button type="button" className="px-2 py-1 rounded border border-slate-200 bg-white" onClick={() => onNudge(2, 0)}>→</button>
          <button type="button" className="px-2 py-1 rounded border border-slate-200 bg-white" onClick={() => onNudge(0, -2)}>↑</button>
          <button type="button" className="px-2 py-1 rounded border border-slate-200 bg-white" onClick={() => onNudge(0, 2)}>↓</button>
        </div>
      )}

      {pendingDrawRect && (
        <FieldEditorPanel
          mode="new"
          onCancel={onPendingFieldCancel}
          onSave={onPendingFieldSave}
        />
      )}

      {editorOpen && editMeta && !pendingDrawRect && (
        <FieldEditorPanel
          mode="edit"
          initialTitle={editMeta.title}
          initialKey={editMeta.key}
          initialType={editMeta.fieldType}
          onCancel={onEditFieldCancel}
          onSave={onEditFieldSave}
        />
      )}

      {uploadedFile && !extracting && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm space-y-1">
          <p className="font-medium text-slate-800 truncate" title={uploadedFile.name}>
            {uploadedFile.name}
          </p>
          {pdfHash && (
            <p className="text-xs text-slate-500 font-mono truncate" title={pdfHash}>
              Hash: {pdfHash.slice(0, 12)}…
            </p>
          )}
          {cacheHit !== null && (
            <p className="text-xs text-slate-600">
              {cacheHit ? 'Loaded from global layout cache' : 'Fresh extraction'}
              {extractionMethod ? ` · ${extractionMethod}` : ''}
            </p>
          )}
        </div>
      )}

      {extracting && (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 bg-slate-200 rounded w-3/4" />
          <div className="h-3 bg-slate-200 rounded w-1/2" />
          <div className="h-20 bg-slate-100 rounded" />
        </div>
      )}

      {uploadedFile && !extracting && pdfHash && fields.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No field boxes yet. Use <strong>Add field</strong> to draw a box on the PDF.
        </div>
      )}

      {fields.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2 mb-2">
            {(['text', 'number', 'date', 'checkbox'] as FieldEditorType[]).map((type) => (
              <span
                key={type}
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium border ${FIELD_TYPE_BOX_CLASSES[type].idle}`}
              >
                {type === 'number' ? 'number' : type}
              </span>
            ))}
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
            Fields on page {currentPage} ({fields.length} total)
          </h3>
          <ul className="space-y-1 max-h-48 overflow-y-auto">
            {pageFields.length === 0 ? (
              <li className="text-sm text-slate-500">No layout fields on this page.</li>
            ) : (
              pageFields.map((f) => {
                const meta = getFieldMeta(f.key);
                const type = meta?.fieldType ?? 'text';
                const typeClass = FIELD_TYPE_BOX_CLASSES[type].idle;
                return (
                <li key={f.key}>
                  <button
                    type="button"
                    onClick={(e) => {
                      const toggle = e.metaKey || e.ctrlKey;
                      if (toggle) {
                        const next = new Set(selectedFieldKeys);
                        if (next.has(f.key)) next.delete(f.key);
                        else next.add(f.key);
                        onSelectFields([...next], f.key, true);
                      } else {
                        onSelectFields([f.key], f.key);
                      }
                    }}
                    className={`w-full text-left rounded-lg px-2.5 py-2 text-sm border transition ${
                      selectedSet.has(f.key)
                        ? FIELD_TYPE_BOX_CLASSES[type].selected
                        : `${typeClass} hover:brightness-[0.98]`
                    }`}
                  >
                    <span className="font-medium truncate block">{f.label}</span>
                    <span className="text-[10px] text-slate-400 font-mono">{f.key}</span>
                  </button>
                </li>
              );
              })
            )}
          </ul>
        </div>
      )}

      {uploadedFile && pdfHash && !extracting && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Practice library
          </p>
          {practiceTemplateId && (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-md px-2 py-1">
              Already in library — save updates the existing form for patients.
            </p>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Document type</label>
            <select
              value={documentType}
              onChange={(e) => onDocumentTypeChange(e.target.value as PdfDocumentType)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              {PDF_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PDF_DOCUMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Controls patient folder category and where filled PDFs are filed.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Name shown when filling for patients"
            />
          </div>
        </div>
      )}

      <div className="mt-auto pt-2 space-y-2">
        {primaryFieldKey && !pendingDrawRect && (
          <button
            type="button"
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={onOpenFieldEditor}
          >
            <Plus className="h-4 w-4" />
            Edit selected field
          </button>
        )}
        <button
          type="button"
          disabled={!canSave || saving}
          onClick={onSaveTemplate}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 shadow-sm"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save to practice library
        </button>
      </div>
    </div>
  );
};
