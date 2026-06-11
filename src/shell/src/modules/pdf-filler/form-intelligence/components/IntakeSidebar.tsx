import React from 'react';
import { FileDown, Loader2 } from 'lucide-react';
import { SchemaFormFields } from '../../components/SchemaFormFields';

interface IntakeSidebarProps {
  hasSchema: boolean;
  schema: Record<string, unknown> | null;
  formData: Record<string, string | boolean>;
  onFormChange: (key: string, value: string | boolean) => void;
  compiling: boolean;
  onCompile: () => void;
  canCompile: boolean;
}

export const IntakeSidebar: React.FC<IntakeSidebarProps> = ({
  hasSchema,
  schema,
  formData,
  onFormChange,
  compiling,
  onCompile,
  canCompile,
}) => {
  if (!hasSchema || !schema) {
    return (
      <div className="p-5 text-sm text-slate-500">
        Upload and extract a PDF in Template Studio mode first, then switch to Data Intake.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-5 h-full min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3">
          Form responses
        </h3>
        <SchemaFormFields schema={schema} values={formData} onChange={onFormChange} />
      </div>
      <button
        type="button"
        disabled={!canCompile || compiling}
        onClick={onCompile}
        className="shrink-0 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {compiling ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        Compile Final Document
      </button>
    </div>
  );
};
