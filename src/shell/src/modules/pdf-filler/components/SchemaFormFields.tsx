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
  /** Override inner scroll container (e.g. full-height patient questionnaire). */
  scrollClassName?: string;
}

export const SchemaFormFields: React.FC<SchemaFormFieldsProps> = ({
  schema,
  values,
  onChange,
  scrollClassName,
}) => {
  const properties = (schema.properties || {}) as Record<string, JsonSchemaProperty>;
  const keys = Object.keys(properties);

  if (keys.length === 0) {
    return (
      <p className="text-sm text-slate-500">This template has no form fields.</p>
    );
  }

  const scrollClasses =
    scrollClassName ?? 'space-y-4 max-h-[min(60vh,520px)] overflow-y-auto pr-1';

  return (
    <div className={scrollClasses.includes('space-y') ? scrollClasses : `space-y-4 ${scrollClasses}`}>
      {keys.map((key) => {
        const prop = properties[key] || {};
        const label = prop.title || key;
        const fieldType =
          prop.type === 'boolean'
            ? 'checkbox'
            : prop.type === 'integer' || prop.type === 'number'
              ? 'number'
              : prop.format === 'date'
                ? 'date'
                : 'text';
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
              type={fieldType === 'date' ? 'date' : fieldType === 'number' ? 'number' : 'text'}
              inputMode={fieldType === 'number' ? 'numeric' : undefined}
              step={fieldType === 'number' ? '1' : undefined}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              value={typeof value === 'string' ? value : ''}
              maxLength={fieldType === 'number' ? undefined : prop.maxLength}
              onChange={(e) => {
                const next = e.target.value;
                if (fieldType === 'number' && next !== '' && !/^-?\d*$/.test(next)) return;
                onChange(key, next);
              }}
            />
          </div>
        );
      })}
    </div>
  );
};
