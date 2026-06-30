import React, { useEffect, useState } from 'react';
import type { FieldEditorType } from '../utils/schemaLayout';
import { slugFromLabel } from '../utils/schemaLayout';
import type { PdfFieldDataSource, PdfFieldFilledBy, PdfFillReview } from '../../../../../../../shared/pdfFieldInference';

export interface PendingFieldRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FieldEditorSaveParams {
  title: string;
  key: string;
  fieldType: FieldEditorType;
  dataSource: PdfFieldDataSource;
  filledBy: PdfFieldFilledBy;
}

interface FieldEditorPanelProps {
  mode: 'new' | 'edit';
  initialTitle?: string;
  initialKey?: string;
  initialType?: FieldEditorType;
  initialDataSource?: PdfFieldDataSource;
  initialFilledBy?: PdfFieldFilledBy;
  fillReview?: PdfFillReview;
  onCancel: () => void;
  onSave: (params: FieldEditorSaveParams) => void;
}

export const FieldEditorPanel: React.FC<FieldEditorPanelProps> = ({
  mode,
  initialTitle = '',
  initialKey = '',
  initialType = 'text',
  initialDataSource = 'none',
  initialFilledBy = 'clinician',
  fillReview = 'suggested',
  onCancel,
  onSave,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [key, setKey] = useState(initialKey || slugFromLabel(initialTitle));
  const [fieldType, setFieldType] = useState<FieldEditorType>(initialType);
  const [dataSource, setDataSource] = useState<PdfFieldDataSource>(initialDataSource);
  const [filledBy, setFilledBy] = useState<PdfFieldFilledBy>(initialFilledBy);

  useEffect(() => {
    setTitle(initialTitle);
    setKey(initialKey || slugFromLabel(initialTitle));
    setFieldType(initialType);
    setDataSource(initialDataSource);
    setFilledBy(initialFilledBy);
  }, [
    initialTitle,
    initialKey,
    initialType,
    initialDataSource,
    initialFilledBy,
    mode,
  ]);

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">
          {mode === 'new' ? 'New field' : 'Edit field'}
        </p>
        {fillReview === 'suggested' && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800">
            Suggested
          </span>
        )}
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Display label</label>
        <input
          type="text"
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (mode === 'new') setKey(slugFromLabel(e.target.value));
          }}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Variable key</label>
        <input
          type="text"
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm font-mono"
          value={key}
          onChange={(e) => setKey(slugFromLabel(e.target.value))}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
        <select
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
          value={fieldType}
          onChange={(e) => setFieldType(e.target.value as FieldEditorType)}
        >
          <option value="text">Text</option>
          <option value="number">Number (integer)</option>
          <option value="date">Date</option>
          <option value="checkbox">Checkbox</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Data source</label>
        <select
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
          value={dataSource}
          onChange={(e) => setDataSource(e.target.value as PdfFieldDataSource)}
        >
          <option value="patient_summary">Patient summary (.md)</option>
          <option value="patient_record">Patient chart record</option>
          <option value="clinician_profile">Clinician profile</option>
          <option value="none">Manual only</option>
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Filled by</label>
        <select
          className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
          value={filledBy}
          onChange={(e) => setFilledBy(e.target.value as PdfFieldFilledBy)}
        >
          <option value="clinician">Clinician</option>
          <option value="patient">Patient</option>
        </select>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-lg bg-indigo-600 text-white text-sm font-semibold py-2 hover:bg-indigo-500"
          onClick={() => {
            const t = title.trim() || 'Field';
            const k = key.trim() || slugFromLabel(t);
            onSave({ title: t, key: k, fieldType, dataSource, filledBy });
          }}
        >
          {mode === 'new' ? 'Add field' : 'Confirm field'}
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-white"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
};
