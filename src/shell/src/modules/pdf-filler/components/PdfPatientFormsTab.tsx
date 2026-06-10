import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Loader2 } from 'lucide-react';
import type { Patient } from '../../../../../../shared/types';
import type { PdfTemplateManifestEntry } from '../../../../../../shared/pdfFiller';
import { PDF_DOCUMENT_TYPE_LABELS } from '../../../../../../shared/pdfFiller';
import {
  fetchPdfTemplates,
  fetchPdfTemplateSchema,
  fillPatientPdfForm,
} from '../services/api';
import { SchemaFormFields } from './SchemaFormFields';

type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;

interface PdfPatientFormsTabProps {
  patient: Patient;
  onToast?: ToastFn;
}

function initialValuesFromSchema(schema: Record<string, unknown>): Record<string, string | boolean> {
  const properties = (schema.properties || {}) as Record<string, { type?: string; default?: unknown }>;
  const out: Record<string, string | boolean> = {};
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === 'boolean') {
      out[key] = Boolean(prop.default);
    } else {
      out[key] = typeof prop.default === 'string' ? prop.default : '';
    }
  }
  return out;
}

export const PdfPatientFormsTab: React.FC<PdfPatientFormsTabProps> = ({ patient, onToast }) => {
  const [templates, setTemplates] = useState<PdfTemplateManifestEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplateManifestEntry | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [generating, setGenerating] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoadingList(true);
    try {
      const { templates: list } = await fetchPdfTemplates();
      setTemplates(list);
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Failed to load templates', 'error');
    } finally {
      setLoadingList(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const selectTemplate = async (templateId: string) => {
    setSelectedId(templateId);
    setLoadingSchema(true);
    setSchema(null);
    try {
      const { template, schema: loaded } = await fetchPdfTemplateSchema(templateId);
      setSelectedTemplate(template);
      setSchema(loaded);
      setValues(initialValuesFromSchema(loaded));
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Failed to load form', 'error');
      setSelectedId(null);
    } finally {
      setLoadingSchema(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedId || !schema) return;
    setGenerating(true);
    try {
      const answers: Record<string, unknown> = { ...values };
      const result = await fillPatientPdfForm(patient.id, {
        templateId: selectedId,
        answers,
      });
      onToast?.(
        `Saved "${result.name}" to ${result.subfolder}`,
        'success'
      );
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Failed to generate PDF', 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full min-h-0">
      <aside className="w-full lg:w-72 shrink-0 space-y-3">
        <div className="flex items-center gap-2 text-slate-800">
          <FileText className="h-5 w-5 text-cyan-600" />
          <h3 className="font-semibold text-sm">Practice forms</h3>
        </div>
        {loadingList ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading templates…
          </div>
        ) : templates.length === 0 ? (
          <p className="text-sm text-slate-500">
            No templates yet. Upload PDFs from the PDF Templates page in the sidebar.
          </p>
        ) : (
          <ul className="space-y-1 max-h-64 overflow-y-auto">
            {templates.map((t) => (
              <li key={t.templateId}>
                <button
                  type="button"
                  onClick={() => void selectTemplate(t.templateId)}
                  className={`w-full text-left rounded-lg px-3 py-2 text-sm transition ${
                    selectedId === t.templateId
                      ? 'bg-cyan-50 text-cyan-800 border border-cyan-200'
                      : 'hover:bg-slate-50 text-slate-700 border border-transparent'
                  }`}
                >
                  <div className="font-medium truncate">{t.displayName}</div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {PDF_DOCUMENT_TYPE_LABELS[t.documentType]}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col rounded-xl border border-slate-200 bg-white p-5">
        {!selectedId ? (
          <p className="text-sm text-slate-500">Select a form to answer questions in Halo UI.</p>
        ) : loadingSchema ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading form…
          </div>
        ) : schema && selectedTemplate ? (
          <>
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-slate-900">{selectedTemplate.displayName}</h3>
              <p className="text-xs text-slate-500 mt-1">
                Filed to patient folder: {PDF_DOCUMENT_TYPE_LABELS[selectedTemplate.documentType]}
              </p>
            </div>
            <SchemaFormFields
              schema={schema}
              values={values}
              onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
            />
            <div className="mt-6 pt-4 border-t border-slate-100">
              <button
                type="button"
                disabled={generating}
                onClick={() => void handleGenerate()}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60"
              >
                {generating && <Loader2 className="h-4 w-4 animate-spin" />}
                Generate PDF to patient folder
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};
