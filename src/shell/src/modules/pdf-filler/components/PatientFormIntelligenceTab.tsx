import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Brain,
  ChevronDown,
  ChevronRight,
  Eye,
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
  fetchPdfClinicianProfile,
  fetchPdfTemplates,
  fetchPdfTemplateSchema,
  fetchPdfTemplatePdf,
  fillPdfFormStream,
  fetchPdfFillerJob,
  startPatientPdfFillJob,
  type PdfFillerFillJob,
} from '../services/api';
import {
  initialFormDataFromSchema,
  schemaKeysWithoutLayout,
  subsetSchemaForKeys,
} from '../form-intelligence/utils/schemaLayout';
import { PdfPageFooter } from '../form-intelligence/components/PdfPageFooter';
import { fileToBase64 } from '../form-intelligence/utils/pdfFile';
import { PdfOverlayFillCanvas } from './PdfOverlayFillCanvas';
import { SchemaFormFields } from './SchemaFormFields';
import {
  mergeHumanFieldDeltas,
  mergePatientIntoFormValues,
  mergeClinicianIntoFormValues,
} from './patientFormPrefill';
import { enrichSchemaWithFieldInference } from '../../../../../../shared/pdfFieldInference';
import { pollJobUntilComplete } from '../../../utils/jobPolling';

type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;

type Step = 'type' | 'form' | 'fill';
type FillViewMode = 'edit' | 'filled';

interface PatientFormIntelligenceTabProps {
  patient: Patient;
  onToast?: ToastFn;
  onSaved?: () => void | Promise<void>;
  defaultDocumentType?: PdfDocumentType;
  /** Fires when background work (load, autofill, save job) is in progress — for tab busy indicators. */
  onBusyChange?: (busy: boolean) => void;
}

export const PatientFormIntelligenceTab: React.FC<PatientFormIntelligenceTabProps> = ({
  patient,
  onToast,
  onSaved,
  defaultDocumentType,
  onBusyChange,
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
  const [previewing, setPreviewing] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [saveJob, setSaveJob] = useState<PdfFillerFillJob | null>(null);
  const activeSaveJobIdRef = useRef<string | null>(null);
  const [includeSignatureOnSave, setIncludeSignatureOnSave] = useState(false);
  const [signatureModeOnSave, setSignatureModeOnSave] = useState<'typed' | 'image'>('image');
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
  const [fillViewMode, setFillViewMode] = useState<FillViewMode>('edit');
  const [filledPreviewUrl, setFilledPreviewUrl] = useState<string | null>(null);
  const [filledPreviewLoading, setFilledPreviewLoading] = useState(false);
  const [filledPreviewError, setFilledPreviewError] = useState<string | null>(null);
  const filledPreviewUrlRef = useRef<string | null>(null);

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

  const saveJobActive =
    saveJob != null && (saveJob.status === 'queued' || saveJob.status === 'running');
  const isBusy = loadingForm || autofilling || saveJobActive;

  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  useEffect(() => {
    return () => {
      onBusyChange?.(false);
    };
  }, [onBusyChange, patient.id]);

  useEffect(() => {
    return () => {
      if (filledPreviewUrlRef.current) {
        URL.revokeObjectURL(filledPreviewUrlRef.current);
        filledPreviewUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (fillViewMode !== 'filled' || !schema || !selectedTemplate || !pdfFile) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setFilledPreviewLoading(true);
        setFilledPreviewError(null);
        try {
          const fileData = await fileToBase64(pdfFile);
          const safeName =
            selectedTemplate.displayName.replace(/[^\w\s.-]+/g, '_').trim() || 'form';
          const blob = await fillPdfFormStream({
            fileName: `preview-${safeName}.pdf`,
            fileData,
            schema,
            answers: { ...values },
          });
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          if (filledPreviewUrlRef.current) {
            URL.revokeObjectURL(filledPreviewUrlRef.current);
          }
          filledPreviewUrlRef.current = url;
          setFilledPreviewUrl(url);
        } catch (e) {
          if (!cancelled) {
            setFilledPreviewError(e instanceof Error ? e.message : 'Failed to generate preview');
          }
        } finally {
          if (!cancelled) setFilledPreviewLoading(false);
        }
      })();
    }, 400);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fillViewMode, values, schema, pdfFile, selectedTemplate]);

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
    setFillViewMode('edit');
    setFilledPreviewError(null);
    setFilledPreviewLoading(false);
    if (filledPreviewUrlRef.current) {
      URL.revokeObjectURL(filledPreviewUrlRef.current);
      filledPreviewUrlRef.current = null;
    }
    setFilledPreviewUrl(null);
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

  useEffect(() => {
    if (!defaultDocumentType || step !== 'type' || loadingList || selectedType) return;
    const count = templatesByType.get(defaultDocumentType)?.length ?? 0;
    if (count > 0) {
      pickType(defaultDocumentType);
    }
  }, [defaultDocumentType, loadingList, step, selectedType, templatesByType]);

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
      const enriched = enrichSchemaWithFieldInference(loaded);
      setSchema(enriched);
      const safeName = template.displayName.replace(/[^\w\s.-]+/g, '_').trim() || 'form';
      setPdfFile(new File([pdfBlob], `${safeName}.pdf`, { type: 'application/pdf' }));
      const base = initialFormDataFromSchema(enriched);
      let merged = mergePatientIntoFormValues(enriched, base, patient);
      try {
        const { profile } = await fetchPdfClinicianProfile();
        merged = mergeClinicianIntoFormValues(enriched, merged, profile);
      } catch {
        // Clinician profile is optional for opening the form.
      }
      setValues(merged);
      setInitialBaseline({ ...merged });
      setAutofillBaseline(null);
      setCurrentPage(1);
      setNumPages(0);
      const unplaced = schemaKeysWithoutLayout(enriched);
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
      const { values: extracted, summaryPending, pendingReason, message } =
        await autofillPatientPdfForm(patient.id, { templateId: selectedId });
      if (summaryPending) {
        const defaultMessage =
          pendingReason === 'autofill_slow'
            ? 'Autofill is taking longer than expected. Wait a moment, then try once more.'
            : 'Patient summary is still building. Try autofill again in a minute.';
        onToast?.(
          message || defaultMessage,
          pendingReason === 'autofill_slow' ? 'error' : 'info'
        );
        return;
      }
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
    setSaveJob(null);
    try {
      const answers: Record<string, unknown> = { ...values };
      const newlyAddedData = mergeHumanFieldDeltas(initialBaseline, autofillBaseline, values);
      const started = await startPatientPdfFillJob(patient.id, {
        templateId: selectedId,
        answers,
        newlyAddedData:
          Object.keys(newlyAddedData).length > 0 ? newlyAddedData : undefined,
        signatureOptions: {
          includeSignature: includeSignatureOnSave,
          mode: signatureModeOnSave,
        },
      });
      activeSaveJobIdRef.current = started.jobId;
      setSaveJob(started.job);

      const job = await pollJobUntilComplete({
        initialJob: started.job,
        fetchJob: async () => (await fetchPdfFillerJob(started.jobId)).job,
        onUpdate: setSaveJob,
        shouldContinue: () => activeSaveJobIdRef.current === started.jobId,
      });
      if (!job) return;

      if (job.status === 'failed') {
        throw new Error(job.error || job.message || 'Failed to save document');
      }
      if (!job.result) {
        throw new Error('PDF save finished without a saved file.');
      }

      const result = job.result;
      let summaryNote = '';
      if (result.summaryPending) {
        summaryNote = ' Patient summary is updating in the background.';
      } else if (result.summaryFieldsUpdated && result.summaryFieldsUpdated > 0) {
        summaryNote = ` Patient summary updated with ${result.summaryFieldsUpdated} field${result.summaryFieldsUpdated === 1 ? '' : 's'}.`;
      }
      onToast?.(`Saved "${result.name}" to ${result.subfolder}.${summaryNote}`, 'success');
      await onSaved?.();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Failed to save document', 'error');
    } finally {
      activeSaveJobIdRef.current = null;
      setSaving(false);
    }
  };

  const handlePreview = async () => {
    if (!schema || !selectedTemplate || !pdfFile) return;
    const previewWindow = window.open('', '_blank');
    if (previewWindow) {
      previewWindow.opener = null;
      previewWindow.document.write('<p style="font-family: sans-serif;">Generating PDF preview...</p>');
    }
    setPreviewing(true);
    try {
      const fileData = await fileToBase64(pdfFile);
      const safeName = selectedTemplate.displayName.replace(/[^\w\s.-]+/g, '_').trim() || 'form';
      const blob = await fillPdfFormStream({
        fileName: `preview-${safeName}.pdf`,
        fileData,
        schema,
        answers: { ...values },
      });
      const url = URL.createObjectURL(blob);
      if (previewWindow) {
        previewWindow.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      if (previewWindow && !previewWindow.closed) previewWindow.close();
      onToast?.(e instanceof Error ? e.message : 'Failed to generate preview', 'error');
    } finally {
      setPreviewing(false);
    }
  };

  const filingSubfolder = selectedTemplate
    ? PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER[selectedTemplate.documentType]
    : selectedType
      ? PDF_DOCUMENT_TYPE_TO_PATIENT_SUBFOLDER[selectedType]
      : null;
  const saveProgressLabel = saveJob && (saveJob.status === 'queued' || saveJob.status === 'running')
    ? `${saveJob.message} ${Math.round(saveJob.progress)}%`
    : null;

  return (
    <div
      className={`flex h-full min-h-0 flex-1 flex-col overflow-hidden ${step === 'fill' ? 'gap-0' : 'gap-4 sm:gap-5'}`}
    >
      <div
        className={`flex shrink-0 flex-col items-stretch sm:flex-row sm:flex-wrap sm:items-start sm:justify-between ${
          step === 'fill' ? 'mb-0 justify-end' : 'gap-3'
        }`}
      >
        {step !== 'fill' && (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600">
              <Brain className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-slate-900">Form Intelligence</h2>
              <p className="text-sm text-slate-500">
                Fill in the form on the document — we save the PDF to{' '}
                <span className="font-medium text-slate-700">{patient.name}</span>&apos;s folder.
              </p>
            </div>
          </div>
        )}
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
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 sm:w-auto"
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
          <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
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
                            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-slate-50 disabled:opacity-60 sm:px-5"
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
                      className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left hover:bg-slate-50 disabled:opacity-60 sm:px-5"
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
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="shrink-0 border-b border-slate-100 px-4 py-4 sm:px-5">
            <div className="flex flex-col items-stretch gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1 xl:pr-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-cyan-600">
                  {PDF_DOCUMENT_TYPE_LABELS[selectedTemplate.documentType]}
                </p>
                <h3
                  className="mt-0.5 line-clamp-2 text-base font-semibold text-slate-900 sm:text-lg"
                  title={selectedTemplate.displayName}
                >
                  {selectedTemplate.displayName}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Uses <span className="font-medium text-slate-600">patient-summary.md</span> at the
                  patient&apos;s root Drive folder (not subfolders you browse under Overview);
                  saving adds your corrections back.
                </p>
                {filingSubfolder && (
                  <p className="text-xs text-slate-500 mt-1">
                    Saving generates a PDF in patient folder →{' '}
                    <span className="font-medium">{filingSubfolder}</span>
                  </p>
                )}
              </div>
              <div className="grid w-full shrink-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:w-auto xl:grid-cols-none xl:flex xl:flex-wrap xl:items-center xl:justify-end">
                <label className="inline-flex min-w-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600">
                  <input
                    type="checkbox"
                    checked={includeSignatureOnSave}
                    onChange={(event) => setIncludeSignatureOnSave(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                  />
                  Sign
                </label>
                {includeSignatureOnSave && (
                  <select
                    value={signatureModeOnSave}
                    onChange={(event) => setSignatureModeOnSave(event.target.value === 'image' ? 'image' : 'typed')}
                    className="min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="typed">Typed</option>
                    <option value="image">Image</option>
                  </select>
                )}
                <button
                  type="button"
                  disabled={autofilling || saving || previewing || loadingForm}
                  onClick={() => void handleAutofill()}
                  title={
                    autofilling
                      ? 'Extracting fields from patient summary (may take up to 2 minutes)'
                      : undefined
                  }
                  className="inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-cyan-200 bg-white px-3 py-2.5 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-60"
                >
                  {autofilling ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {autofilling ? 'Autofilling…' : 'Autofill from summary'}
                </button>
                <button
                  type="button"
                  disabled={previewing || saving || autofilling || loadingForm || !pdfFile}
                  onClick={() => void handlePreview()}
                  className="inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                  Open in new tab
                </button>
                <button
                  type="button"
                  disabled={saving || previewing || autofilling || loadingForm}
                  onClick={() => void handleSave()}
                  className="inline-flex min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-cyan-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {saveProgressLabel || 'Save to patient folder'}
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
              <div className="flex shrink-0 items-center gap-1 border-b border-slate-100 bg-slate-50/90 px-4 py-2 sm:px-5">
                <span className="mr-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  View
                </span>
                <button
                  type="button"
                  onClick={() => setFillViewMode('edit')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    fillViewMode === 'edit'
                      ? 'bg-white text-cyan-800 shadow-sm ring-1 ring-cyan-200'
                      : 'text-slate-600 hover:bg-white/80'
                  }`}
                >
                  Edit on PDF
                </button>
                <button
                  type="button"
                  onClick={() => setFillViewMode('filled')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    fillViewMode === 'filled'
                      ? 'bg-white text-cyan-800 shadow-sm ring-1 ring-cyan-200'
                      : 'text-slate-600 hover:bg-white/80'
                  }`}
                >
                  Filled PDF
                </button>
              </div>
              <div className="flex min-h-0 flex-1 basis-0 flex-col overflow-hidden">
                {fillViewMode === 'edit' ? (
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
                ) : (
                  <div className="relative min-h-0 flex-1 bg-slate-100/60">
                    {filledPreviewLoading && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80">
                        <Loader2 className="h-8 w-8 animate-spin text-cyan-600" />
                      </div>
                    )}
                    {filledPreviewError && !filledPreviewLoading && (
                      <div className="flex h-full min-h-[320px] items-center justify-center p-6 text-center text-sm text-red-600">
                        {filledPreviewError}
                      </div>
                    )}
                    {filledPreviewUrl && !filledPreviewError && (
                      <iframe
                        title="Filled PDF preview"
                        src={filledPreviewUrl}
                        className="h-full min-h-[min(70vh,640px)] w-full border-0 bg-white"
                      />
                    )}
                  </div>
                )}
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
