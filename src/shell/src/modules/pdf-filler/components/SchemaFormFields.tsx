import React from 'react';

type JsonSchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  format?: string;
  default?: unknown;
  maxLength?: number;
};

interface SchemaFormFieldsProps {
  schema: Record<string, unknown>;
  values: Record<string, string | boolean>;
  onChange: (key: string, value: string | boolean) => void;
}

export const SchemaFormFields: React.FC<SchemaFormFieldsProps> = ({ schema, values, onChange }) => {
  const properties = (schema.properties || {}) as Record<string, JsonSchemaProperty>;
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return (
      <p className="text-sm text-slate-500">This template has no form fields.</p>
    );
  }

  return (
    <div className="space-y-4 max-h-[min(60vh,520px)] overflow-y-auto pr-1">
      {keys.map((key) => {
        const prop = properties[key] || {};
        const label = prop.title || key;
        const fieldType = prop.type === 'boolean' ? 'checkbox' : prop.format === 'date' ? 'date' : 'text';
        const value = values[key];

        if (fieldType === 'checkbox') {
          return (
            <label key={key} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-cyan-600"
                checked={Boolean(value)}
                onChange={(e) => onChange(key, e.target.checked)}
              />
              <span className="text-sm text-slate-800">{label}</span>
            </label>
          );
        }

        return (
          <div key={key}>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">
              {label}
            </label>
            <input
              type={fieldType === 'date' ? 'date' : 'text'}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              value={typeof value === 'string' ? value : ''}
              maxLength={prop.maxLength}
              onChange={(e) => onChange(key, e.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
};
