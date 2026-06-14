import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  FileStack,
  LayoutTemplate,
  Loader2,
  Paperclip,
  Pencil,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  PDF_DOCUMENT_TYPES,
  PDF_DOCUMENT_TYPE_LABELS,
  type PdfDocumentType,
  type PdfTemplateManifestEntry,
} from '../../../../../shared/pdfFiller';
import {
  countTemplatesByDocumentType,
  insurerGroupLabel,
  sortedInsurerKeys,
  templatesForDocumentType,
  templatesForInsurer,
} from '../../../../../shared/templateLibraryGrouping';
import {
  INSURANCE_COMPANIES,
} from '../../../../../shared/insuranceCompanies';
import {
  attachSharedFormPdf,
  deletePdfTemplate,
  fetchPdfTemplates,
  updatePdfTemplate,
} from './services/api';
import { PdfExtractionProgress } from './components/PdfExtractionProgress';
import { useTemplateUploadQueue } from './hooks/useTemplateUploadQueue';
import { KeepFormPrivateControl } from './components/KeepFormPrivateControl';
import {
  documentTypeIconClass,
  PDF_DOCUMENT_TYPE_ICONS,
} from './components/pdfDocumentTypeIcons';
import { fileToBase64 } from './form-intelligence/utils/pdfFile';

type BrowseStep = 'types' | 'insurers' | 'forms';

type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;

interface PdfTemplatesPageProps {
  onToast?: ToastFn;
  onOpenInStudio?: (templateId: string) => void;
}

export const PdfTemplatesPage: React.FC<PdfTemplatesPageProps> = ({ onToast, onOpenInStudio }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<PdfTemplateManifestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [documentType, setDocumentType] = useState<PdfDocumentType>('insurance_form');
  const [insuranceCompanyId, setInsuranceCompanyId] = useState(INSURANCE_COMPANIES[0]?.id ?? '');
  const [displayName, setDisplayName] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<PdfTemplateManifestEntry | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');
  const [editDocumentType, setEditDocumentType] = useState<PdfDocumentType>('insurance_form');
  const [editInsuranceCompanyId, setEditInsuranceCompanyId] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [keepPrivate, setKeepPrivate] = useState(false);
  const [browseStep, setBrowseStep] = useState<BrowseStep>('types');
  const [browseType, setBrowseType] = useState<PdfDocumentType | null>(null);
  const [browseInsurer, setBrowseInsurer] = useState<string | null>(null);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachHash, setAttachHash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { templates: list } = await fetchPdfTemplates();
      setTemplates(list);
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Failed to load templates', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  const { jobs, enqueue, dismissCompleted, hasActive } = useTemplateUploadQueue(() => {
    void refresh();
  });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const insuranceRequired = documentType === 'insurance_form';
  const canEnqueue = true;

  const countByType = countTemplatesByDocumentType(templates);
  const typesWithTemplates = PDF_DOCUMENT_TYPES.filter((t) => (countByType.get(t) ?? 0) > 0);
  const templatesInBrowseType = browseType ? templatesForDocumentType(templates, browseType) : [];
  const browseInsurerKeys =
    browseType === 'insurance_form' ? sortedInsurerKeys(templatesInBrowseType) : [];
  const documentsInFolder =
    browseType === 'insurance_form' && browseInsurer !== null
      ? templatesForInsurer(templatesInBrowseType, browseInsurer)
      : browseType && browseType !== 'insurance_form'
        ? templatesInBrowseType
        : [];

  const libraryBreadcrumb = () => {
    const parts = ['Saved templates'];
    if (browseType) parts.push(PDF_DOCUMENT_TYPE_LABELS[browseType]);
    if (browseType === 'insurance_form' && browseInsurer !== null) {
      parts.push(insurerGroupLabel(browseInsurer));
    }
    return parts;
  };

  const handleFilesSelected = (files: FileList | null) => {
    if (!files?.length) return;
    const count = enqueue({
      files: Array.from(files),
      documentType,
      insuranceCompanyId: insuranceRequired ? insuranceCompanyId : undefined,
      displayName,
      keepPrivate,
    });
    if (count === 0) {
      onToast?.('Please choose PDF files only.', 'error');
      return;
    }
    onToast?.(
      count === 1 ? 'Template upload started.' : `${count} template uploads started.`,
      'info'
    );
    setDisplayName('');
  };

  const openEdit = (t: PdfTemplateManifestEntry) => {
    setEditTarget(t);
    setEditDisplayName(t.displayName);
    setEditDocumentType(t.documentType);
    setEditInsuranceCompanyId(t.insuranceCompanyId ?? INSURANCE_COMPANIES[0]?.id ?? '');
  };

  const closeEdit = () => {
    if (editSaving) return;
    setEditTarget(null);
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    if (editDocumentType === 'insurance_form' && !editInsuranceCompanyId) {
      onToast?.('Select an insurance company for insurance forms.', 'error');
      return;
    }
    setEditSaving(true);
    try {
      await updatePdfTemplate(editTarget.templateId, {
        displayName: editDisplayName.trim(),
        documentType: editDocumentType,
        insuranceCompanyId:
          editDocumentType === 'insurance_form' ? editInsuranceCompanyId : undefined,
      });
      onToast?.('Template updated.', 'success');
      setEditTarget(null);
      await refresh();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Update failed', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    setDeletingId(templateId);
    try {
      await deletePdfTemplate(templateId);
      onToast?.('Template removed from library', 'success');
      await refresh();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Delete failed', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const subtitleForTemplate = (t: PdfTemplateManifestEntry) => {
    const parts = [t.extractionMethod, `updated ${new Date(t.updatedAt).toLocaleDateString()}`];
    if (t.pdfPending) parts.unshift('PDF attach required');
    return parts.join(' · ');
  };

  const triggerAttachPdf = (pdfHash: string) => {
    setAttachHash(pdfHash);
    attachInputRef.current?.click();
  };

  const onAttachFile = async (file: File) => {
    if (!attachHash) return;
    try {
      const fileData = await fileToBase64(file);
      await attachSharedFormPdf(attachHash, { fileName: file.name, fileData });
      onToast?.('Blank PDF attached.', 'success');
      await refresh();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Attach failed', 'error');
    } finally {
      setAttachHash(null);
    }
  };

  const renderDocumentRow = (t: PdfTemplateManifestEntry) => (
    <li key={t.templateId} className="px-6 py-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 truncate">{t.displayName}</p>
        <p className="text-xs text-slate-500 mt-0.5">{subtitleForTemplate(t)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {t.pdfPending && t.pdfHash && (
          <button
            type="button"
            onClick={() => triggerAttachPdf(t.pdfHash!)}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50"
          >
            <Paperclip className="h-4 w-4" />
            Attach PDF
          </button>
        )}
        {onOpenInStudio && !t.pdfPending && (
          <button
            type="button"
            onClick={() => onOpenInStudio(t.templateId)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-cyan-700 hover:bg-cyan-50"
          >
            <LayoutTemplate className="h-4 w-4" />
            Layout
          </button>
        )}
        <button type="button" onClick={() => openEdit(t)} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          disabled={deletingId === t.templateId}
          onClick={() => void handleDelete(t.templateId)}
          className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
        >
          {deletingId === t.templateId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
        </button>
      </div>
    </li>
  );

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-6 md:p-8">
      <input
        ref={attachInputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onAttachFile(f);
          e.target.value = '';
        }}
      />
      <div className="max-w-4xl mx-auto space-y-8">
        <header>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-cyan-100 flex items-center justify-center">
              <FileStack className="h-5 w-5 text-cyan-700" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">PDF Templates</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Upload forms once. Stored on Drive under Practice Admin / PDF Documents. Patients
                complete them in Halo UI.
              </p>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
          <h2 className="text-sm font-semibold text-slate-800">Upload new template</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Document type</label>
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value as PdfDocumentType)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {PDF_DOCUMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {PDF_DOCUMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                Controls which patient subfolder receives filled PDFs.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Display name (optional)
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Chronic Illness Application"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <p className="text-xs text-slate-400 mt-1">
                For multiple PDFs, used as a prefix before each file name.
              </p>
            </div>
          </div>

          {insuranceRequired && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                Insurance company
              </label>
              <select
                value={insuranceCompanyId}
                onChange={(e) => setInsuranceCompanyId(e.target.value)}
                className="w-full max-w-md rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {INSURANCE_COMPANIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">
                Suggested default — insurer is auto-detected from the PDF when possible.
              </p>
            </div>
          )}

          <KeepFormPrivateControl keepPrivate={keepPrivate} onChange={setKeepPrivate} />

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFilesSelected(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={!canEnqueue}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            Choose PDFs
          </button>
        </section>

        {jobs.length > 0 && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Uploads in progress</h2>
              {!hasActive && (
                <button
                  type="button"
                  onClick={dismissCompleted}
                  className="text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  Clear finished
                </button>
              )}
            </div>
            <ul className="space-y-3">
              {jobs.map((job) => (
                <li key={job.id}>
                  {job.status === 'running' ? (
                    <PdfExtractionProgress
                      active
                      fileName={job.fileName}
                      phaseLabel="Analyzing and saving"
                      remainingLabel={job.remainingLabel || 'Finishing up…'}
                      progressPercent={job.progressPercent}
                    />
                  ) : (
                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm">
                      <p className="font-medium text-slate-800 truncate" title={job.fileName}>
                        {job.fileName}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5 capitalize">
                        {job.status === 'queued' && 'Queued'}
                        {job.status === 'done' && 'Saved to library'}
                        {job.status === 'error' && (job.error ?? 'Failed')}
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 space-y-2">
            <h2 className="text-sm font-semibold text-slate-800">Saved templates</h2>
            {templates.length > 0 && (
              <nav className="text-xs text-slate-500 flex flex-wrap items-center gap-1">
                {libraryBreadcrumb().map((label, i) => (
                  <React.Fragment key={`${label}-${i}`}>
                    {i > 0 && <span className="text-slate-300">›</span>}
                    <button
                      type="button"
                      className={
                        i === libraryBreadcrumb().length - 1
                          ? 'font-semibold text-slate-700'
                          : 'hover:text-cyan-700'
                      }
                      onClick={() => {
                        if (i === 0) {
                          setBrowseStep('types');
                          setBrowseType(null);
                          setBrowseInsurer(null);
                        } else if (i === 1 && browseType) {
                          setBrowseStep(browseType === 'insurance_form' ? 'insurers' : 'forms');
                          setBrowseInsurer(null);
                        }
                      }}
                    >
                      {label}
                    </button>
                  </React.Fragment>
                ))}
              </nav>
            )}
          </div>
          {loading ? (
            <div className="p-8 flex justify-center text-slate-500 text-sm">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No templates uploaded yet.</p>
          ) : browseStep === 'types' ? (
            <div className="p-4 grid gap-3 sm:grid-cols-2">
              {typesWithTemplates.map((documentType) => {
                const Icon = PDF_DOCUMENT_TYPE_ICONS[documentType];
                const count = countByType.get(documentType) ?? 0;
                return (
                  <button
                    key={documentType}
                    type="button"
                    onClick={() => {
                      setBrowseType(documentType);
                      setBrowseStep(documentType === 'insurance_form' ? 'insurers' : 'forms');
                      setBrowseInsurer(null);
                    }}
                    className="flex items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-left hover:border-cyan-200 hover:bg-white transition"
                  >
                    <div
                      className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${documentTypeIconClass(documentType)}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 text-sm">
                        {PDF_DOCUMENT_TYPE_LABELS[documentType]}
                      </div>
                      <div className="text-xs text-slate-500">{count} form{count === 1 ? '' : 's'}</div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-300" />
                  </button>
                );
              })}
            </div>
          ) : browseStep === 'insurers' && browseType === 'insurance_form' ? (
            <ul className="divide-y divide-slate-100">
              {browseInsurerKeys.map((key) => {
                const count = templatesInBrowseType.filter((t) => (t.insuranceCompanyId ?? '') === key).length;
                return (
                  <li key={key || 'uncategorized'}>
                    <button
                      type="button"
                      onClick={() => {
                        setBrowseInsurer(key);
                        setBrowseStep('forms');
                      }}
                      className="flex w-full items-center justify-between px-6 py-4 text-left hover:bg-slate-50"
                    >
                      <div>
                        <p className="font-medium text-slate-900">{insurerGroupLabel(key)}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {count} document{count === 1 ? '' : 's'}
                        </p>
                      </div>
                      <ChevronRight className="h-5 w-5 text-slate-300" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="divide-y divide-slate-100">{documentsInFolder.map(renderDocumentRow)}</ul>
          )}
        </section>
      </div>

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 p-6 space-y-4"
            role="dialog"
            aria-labelledby="edit-template-title"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 id="edit-template-title" className="text-lg font-semibold text-slate-900">
                Edit template
              </h2>
              <button
                type="button"
                onClick={closeEdit}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Display name</label>
              <input
                type="text"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Document type</label>
              <select
                value={editDocumentType}
                onChange={(e) => setEditDocumentType(e.target.value as PdfDocumentType)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {PDF_DOCUMENT_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {PDF_DOCUMENT_TYPE_LABELS[dt]}
                  </option>
                ))}
              </select>
            </div>

            {editDocumentType === 'insurance_form' && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Insurance company
                </label>
                <select
                  value={editInsuranceCompanyId}
                  onChange={(e) => setEditInsuranceCompanyId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                >
                  {INSURANCE_COMPANIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={editSaving}
                onClick={closeEdit}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={editSaving || !editDisplayName.trim()}
                onClick={() => void saveEdit()}
                className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
