import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Brain,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Save,
  Sparkles,
} from 'lucide-react';
import type { Patient } from '../../../../../../shared/types';
import type { PdfDocumentType, PdfTemplateManifestEntry } from '../../../../../../shared/pdfFiller';
import {
  PDF_DOCUMENT_TYPES,
  PDF_DOCUMENT_TYPE_LABELS,
  PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER,
} from '../../../../../../shared/pdfFiller';
import {
  getInsuranceCompanyLabel,
  UNCATEGORIZED_INSURER_LABEL,
} from '../../../../../../shared/insuranceCompanies';
import {
  autofillPatientPdfForm,
  fetchPdfTemplates,
  fetchPdfTemplateSchema,
  fetchPdfTemplatePdf,
  fillPatientPdfForm,
} from '../services/api';
import {
  initialFormDataFromSchema,
  schemaKeysWithoutLayout,
  subsetSchemaForKeys,
} from '../form-intelligence/utils/schemaLayout';
import { PdfPageFooter } from '../form-intelligence/components/PdfPageFooter';
import { PdfOverlayFillCanvas } from './PdfOverlayFillCanvas';
import { SchemaFormFields } from './SchemaFormFields';
import {
  mergeHumanFieldDeltas,
  mergePatientIntoFormValues,
} from './patientFormPrefill';

type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;

type Step = 'type' | 'form' | 'fill';

interface PatientFormIntelligenceTabProps {
  patient: Patient;
  onToast?: ToastFn;
}

export const PatientFormIntelligenceTab: React.FC<PatientFormIntelligenceTabProps> = ({
  patient,
  onToast,
}) => {
  const [templates, setTemplates] = useState<PdfTemplateManifestEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [step, setStep] = useState<Step>('type');
  const [selectedType, setSelectedType] = useState<PdfDocumentType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schema, setSchema] = useState<Record<string, unknown> | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<PdfTemplateManifestEntry | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [loadingForm, setLoadingForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [initialBaseline, setInitialBaseline] = useState<Record<string, string | boolean> | null>(
    null
  );
  const [autofillBaseline, setAutofillBaseline] = useState<Record<
    string,
    string | null
  > | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [unplacedOpen, setUnplacedOpen] = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoadingList(true);
    try {
      const { templates: list } = await fetchPdfTemplates();
      setTemplates(list);
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Failed to load forms', 'error');
    } finally {
      setLoadingList(false);
    }
  }, [onToast]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const templatesByType = useMemo(() => {
    const map = new Map<PdfDocumentType, PdfTemplateManifestEntry[]>();
    for (const t of PDF_DOCUMENT_TYPES) {
      map.set(t, []);
    }
    for (const t of templates) {
      map.get(t.documentType)?.push(t);
    }
    return map;
  }, [templates]);

  const typesWithForms = useMemo(
    () => PDF_DOCUMENT_TYPES.filter((t) => (templatesByType.get(t)?.length ?? 0) > 0),
    [templatesByType]
  );

  const formsForSelectedType = useMemo(
    () => (selectedType ? templatesByType.get(selectedType) ?? [] : []),
    [selectedType, templatesByType]
  );

  const insuranceFormGroups = useMemo(() => {
    if (selectedType !== 'insurance_form') return null;
    const groups = new Map<string, PdfTemplateManifestEntry[]>();
    for (const t of formsForSelectedType) {
      const key = t.insuranceCompanyId ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    const keys = [...groups.keys()].sort((a, b) => {
      const la = a ? getInsuranceCompanyLabel(a) ?? a : UNCATEGORIZED_INSURER_LABEL;
      const lb = b ? getInsuranceCompanyLabel(b) ?? b : UNCATEGORIZED_INSURER_LABEL;
      return la.localeCompare(lb);
    });
    return keys.map((key) => ({
      label: key ? getInsuranceCompanyLabel(key) ?? key : UNCATEGORIZED_INSURER_LABEL,
      templates: groups.get(key) ?? [],
    }));
  }, [formsForSelectedType, selectedType]);

  const unplacedKeys = useMemo(
    () => (schema ? schemaKeysWithoutLayout(schema) : []),
    [schema]
  );

  const unplacedSchema = useMemo(() => {
    if (!schema || unplacedKeys.length === 0) return null;
    return subsetSchemaForKeys(schema, unplacedKeys);
  }, [schema, unplacedKeys]);

  const resetFillState = () => {
    setSelectedId(null);
    setSchema(null);
    setSelectedTemplate(null);
    setPdfFile(null);
    setValues({});
    setInitialBaseline(null);
    setAutofillBaseline(null);
    setCurrentPage(1);
    setNumPages(0);
    setUnplacedOpen(false);
  };

  const goToTypeStep = () => {
    setStep('type');
    setSelectedType(null);
    resetFillState();
  };

  const pickType = (documentType: PdfDocumentType) => {
    setSelectedType(documentType);
    resetFillState();
    setStep('form');
  };

  const pickForm = async (templateId: string) => {
    setSelectedId(templateId);
    setLoadingForm(true);
    setSchema(null);
    setPdfFile(null);
    try {
      const [{ template, schema: loaded }, pdfBlob] = await Promise.all([
        fetchPdfTemplateSchema(templateId),
        fetchPdfTemplatePdf(templateId),
      ]);
      setSelectedTemplate(template);
      setSchema(loaded);
      const safeName = template.displayName.replace(/[^\w\s.-]+/g, '_').trim() || 'form';
      setPdfFile(new File([pdfBlob], `${safeName}.pdf`, { type: 'application/pdf' }));
      const base = initialFormDataFromSchema(loaded);
      const merged = mergePatientIntoFormValues(loaded, base, patient);
      setValues(merged);
      setInitialBaseline({ ...merged });
      setAutofillBaseline(null);
      setCurrentPage(1);
      setNumPages(0);
      const unplaced = schemaKeysWithoutLayout(loaded);
      setUnplacedOpen(unplaced.length > 0);
      setStep('fill');
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Failed to load form', 'error');
      setSelectedId(null);
    } finally {
      setLoadingForm(false);
    }
  };

  const handleAutofill = async () => {
    if (!selectedId) return;
    setAutofilling(true);
    try {
      const { values: extracted } = await autofillPatientPdfForm(patient.id, {
        templateId: selectedId,
      });
      setAutofillBaseline(extracted);
      setValues((prev) => {
        const next = { ...prev };
        for (const [key, raw] of Object.entries(extracted)) {
          if (raw === null || raw === undefined) continue;
          const trimmed = String(raw).trim();
          if (!trimmed) continue;
          const current = next[key];
          if (typeof current === 'string' && current.trim() !== '') continue;
          if (typeof current === 'boolean' && current) continue;
          next[key] = trimmed;
        }
        return next;
      });
      const filledCount = Object.values(extracted).filter(
        (v) => v !== null && String(v).trim() !== ''
      ).length;
      onToast?.(
        filledCount > 0
          ? `Autofill applied ${filledCount} field${filledCount === 1 ? '' : 's'} from patient summary.`
          : 'No matching data in patient summary yet — fill in manually.',
        filledCount > 0 ? 'success' : 'info'
      );
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Autofill failed', 'error');
    } finally {
      setAutofilling(false);
    }
  };

  const handleSave = async () => {
    if (!selectedId || !schema || !selectedTemplate) return;
    setSaving(true);
    try {
      const answers: Record<string, unknown> = { ...values };
      const newlyAddedData = mergeHumanFieldDeltas(initialBaseline, autofillBaseline, values);
      const result = await fillPatientPdfForm(patient.id, {
        templateId: selectedId,
        answers,
        newlyAddedData:
          Object.keys(newlyAddedData).length > 0 ? newlyAddedData : undefined,
      });
      const summaryNote =
        result.summaryFieldsUpdated && result.summaryFieldsUpdated > 0
          ? ` Patient summary updated with ${result.summaryFieldsUpdated} field${result.summaryFieldsUpdated === 1 ? '' : 's'}.`
          : '';
      onToast?.(`Saved "${result.name}" to ${result.subfolder}.${summaryNote}`, 'success');
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Failed to save document', 'error');
    } finally {
      setSaving(false);
    }
  };

  const filingSubfolder = selectedTemplate
    ? PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER[selectedTemplate.documentType]
    : selectedType
      ? PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER[selectedType]
      : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Form Intelligence</h2>
            <p className="text-sm text-slate-500">
              Fill in the form on the document — we save the PDF to{' '}
              <span className="font-medium text-slate-700">{patient.name}</span>&apos;s folder.
            </p>
          </div>
        </div>
        {step !== 'type' && (
          <button
            type="button"
            onClick={() => {
              if (step === 'fill') {
                setStep('form');
                resetFillState();
              } else {
                goToTypeStep();
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        )}
      </div>

      {loadingList ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading practice forms…
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm text-slate-600 font-medium">No forms configured yet</p>
          <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">
            In sidebar → Form Intelligence → Template Studio: extract fields, set document type, then{' '}
            <strong>Save to practice library</strong>.
          </p>
        </div>
      ) : step === 'type' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {typesWithForms.map((documentType) => {
            const count = templatesByType.get(documentType)?.length ?? 0;
            return (
              <button
                key={documentType}
                type="button"
                onClick={() => pickType(documentType)}
                className="group flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-cyan-200 hover:shadow-md"
              >
                <div>
                  <div className="font-semibold text-slate-900">
                    {PDF_DOCUMENT_TYPE_LABELS[documentType]}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {count} form{count === 1 ? '' : 's'} · files to{' '}
                    {PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER[documentType]}
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-cyan-500" />
              </button>
            );
          })}
        </div>
      ) : step === 'form' && selectedType ? (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-100 px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-600">
              {PDF_DOCUMENT_TYPE_LABELS[selectedType]}
            </p>
            <h3 className="text-base font-semibold text-slate-900 mt-0.5">Choose a form</h3>
          </div>
          <ul className="divide-y divide-slate-100">
            {insuranceFormGroups
              ? insuranceFormGroups.map((group) => (
                  <li key={group.label}>
                    <div className="px-5 py-2 bg-slate-50 border-b border-slate-100">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {group.label}
                      </p>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {group.templates.map((t) => (
                        <li key={t.templateId}>
                          <button
                            type="button"
                            disabled={loadingForm && selectedId === t.templateId}
                            onClick={() => void pickForm(t.templateId)}
                            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50 disabled:opacity-60"
                          >
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900 truncate">{t.displayName}</div>
                              <div className="text-xs text-slate-500 mt-0.5">
                                Updated {new Date(t.updatedAt).toLocaleDateString()}
                              </div>
                            </div>
                            {loadingForm && selectedId === t.templateId ? (
                              <Loader2 className="h-5 w-5 shrink-0 animate-spin text-cyan-600" />
                            ) : (
                              <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))
              : formsForSelectedType.map((t) => (
                  <li key={t.templateId}>
                    <button
                      type="button"
                      disabled={loadingForm && selectedId === t.templateId}
                      onClick={() => void pickForm(t.templateId)}
                      className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50 disabled:opacity-60"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{t.displayName}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Updated {new Date(t.updatedAt).toLocaleDateString()}
                        </div>
                      </div>
                      {loadingForm && selectedId === t.templateId ? (
                        <Loader2 className="h-5 w-5 shrink-0 animate-spin text-cyan-600" />
                      ) : (
                        <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
                      )}
                    </button>
                  </li>
                ))}
          </ul>
        </div>
      ) : step === 'fill' && schema && selectedTemplate ? (
        <div className="flex flex-1 min-h-0 flex-col rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="shrink-0 border-b border-slate-100 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-600">
                  {PDF_DOCUMENT_TYPE_LABELS[selectedTemplate.documentType]}
                </p>
                <h3 className="text-lg font-semibold text-slate-900 mt-0.5">{selectedTemplate.displayName}</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Uses <span className="font-medium text-slate-600">patient-summary.md</span> in this
                  patient&apos;s Drive folder; saving adds your corrections back.
                </p>
                {filingSubfolder && (
                  <p className="text-xs text-slate-500 mt-1">
                    Saving generates a PDF in patient folder →{' '}
                    <span className="font-medium">{filingSubfolder}</span>
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={autofilling || saving || loadingForm}
                  onClick={() => void handleAutofill()}
                  className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-white px-4 py-2.5 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-60"
                >
                  {autofilling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Autofill from summary
                </button>
                <button
                  type="button"
                  disabled={saving || autofilling || loadingForm}
                  onClick={() => void handleSave()}
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save to patient folder
                </button>
              </div>
            </div>
          </div>

          {loadingForm ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin text-cyan-600" />
              Loading form preview…
            </div>
          ) : (
            <>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <PdfOverlayFillCanvas
                  pdfFile={pdfFile}
                  schema={schema}
                  values={values}
                  currentPage={currentPage}
                  onDocumentLoad={setNumPages}
                  onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
                />
                <PdfPageFooter
                  currentPage={currentPage}
                  numPages={numPages}
                  onPageChange={setCurrentPage}
                />
              </div>

              {unplacedSchema && unplacedKeys.length > 0 && (
                <div className="shrink-0 border-t border-slate-100 bg-slate-50/80">
                  <button
                    type="button"
                    onClick={() => setUnplacedOpen((o) => !o)}
                    className="flex w-full items-center justify-between gap-2 px-5 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-100/80"
                  >
                    <span>
                      Additional fields not shown on preview ({unplacedKeys.length})
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-400 transition ${unplacedOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {unplacedOpen && (
                    <div className="max-h-48 overflow-y-auto border-t border-slate-100 px-5 py-4">
                      <SchemaFormFields
                        schema={unplacedSchema}
                        values={values}
                        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))}
                        scrollClassName="max-h-none overflow-visible pr-0"
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
