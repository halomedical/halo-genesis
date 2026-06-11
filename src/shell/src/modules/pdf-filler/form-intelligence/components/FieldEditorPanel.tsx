import React, { useEffect, useState } from 'react';
import type { FieldEditorType } from '../utils/schemaLayout';
import { slugFromLabel } from '../utils/schemaLayout';

export interface PendingFieldRect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FieldEditorPanelProps {
  mode: 'new' | 'edit';
  initialTitle?: string;
  initialKey?: string;
  initialType?: FieldEditorType;
  onCancel: () => void;
  onSave: (params: { title: string; key: string; fieldType: FieldEditorType }) => void;
}

export const FieldEditorPanel: React.FC<FieldEditorPanelProps> = ({
  mode,
  initialTitle = '',
  initialKey = '',
  initialType = 'text',
  onCancel,
  onSave,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [key, setKey] = useState(initialKey || slugFromLabel(initialTitle));
  const [fieldType, setFieldType] = useState<FieldEditorType>(initialType);

  useEffect(() => {
    setTitle(initialTitle);
    setKey(initialKey || slugFromLabel(initialTitle));
    setFieldType(initialType);
  }, [initialTitle, initialKey, initialType, mode]);

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800">
        {mode === 'new' ? 'New field' : 'Edit field'}
      </p>
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
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-lg bg-indigo-600 text-white text-sm font-semibold py-2 hover:bg-indigo-500"
          onClick={() => {
            const t = title.trim() || 'Field';
            const k = key.trim() || slugFromLabel(t);
            onSave({ title: t, key: k, fieldType });
          }}
        >
          {mode === 'new' ? 'Add field' : 'Apply'}
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
