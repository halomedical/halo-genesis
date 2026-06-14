import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronRight,
  Download,
  Globe,
  Loader2,
  Package,
} from 'lucide-react';
import {
  PDF_DOCUMENT_TYPES,
  PDF_DOCUMENT_TYPE_LABELS,
  type PdfDocumentType,
} from '../../../../../shared/pdfFiller';
import {
  countTemplatesByDocumentType,
  insurerGroupLabel,
  sortedInsurerKeys,
  templatesForInsurer,
} from '../../../../../shared/templateLibraryGrouping';
import {
  getInsuranceCompanyLabel,
  INSURANCE_COMPANIES,
} from '../../../../../shared/insuranceCompanies';
import {
  attachSharedFormPdf,
  fetchSharedFormsCatalog,
  importSharedForm,
  importSharedFormPack,
  type SharedFormCatalogEntry,
} from './services/api';
import { fileToBase64 } from './form-intelligence/utils/pdfFile';
import {
  documentTypeIconClass,
  PDF_DOCUMENT_TYPE_ICONS,
} from './components/pdfDocumentTypeIcons';

type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;
type BrowseStep = 'types' | 'insurers' | 'forms';

interface SharedFormsPageProps {
  onToast?: ToastFn;
}

export const SharedFormsPage: React.FC<SharedFormsPageProps> = ({ onToast }) => {
  const [entries, setEntries] = useState<SharedFormCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<BrowseStep>('types');
  const [selectedType, setSelectedType] = useState<PdfDocumentType | null>(null);
  const [selectedInsurer, setSelectedInsurer] = useState<string | null>(null);
  const [busyHash, setBusyHash] = useState<string | null>(null);
  const [packLoading, setPackLoading] = useState(false);
  const attachInputRef = useRef<HTMLInputElement>(null);
  const [attachHash, setAttachHash] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { entries: list } = await fetchSharedFormsCatalog();
      setEntries(list);
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Failed to load shared forms', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const countByType = countTemplatesByDocumentType(
    entries.map((e) => ({
      templateId: e.pdf_hash,
      displayName: e.display_name,
      documentType: e.document_type,
      insuranceCompanyId: e.insurance_company_id ?? undefined,
      pdfDriveFileId: '',
      schemaDriveFileId: '',
      extractionMethod: e.extraction_method,
      schemaVersion: e.schema_version,
      createdAt: '',
      updatedAt: '',
    }))
  );

  const typesWithEntries = PDF_DOCUMENT_TYPES.filter((t) => (countByType.get(t) ?? 0) > 0);

  const entriesForType = selectedType
    ? entries.filter((e) => e.document_type === selectedType)
    : [];

  const insurerKeys =
    selectedType === 'insurance_form' ? sortedInsurerKeys(
        entriesForType.map((e) => ({
          templateId: e.pdf_hash,
          displayName: e.display_name,
          documentType: e.document_type,
          insuranceCompanyId: e.insurance_company_id ?? undefined,
          pdfDriveFileId: '',
          schemaDriveFileId: '',
          extractionMethod: e.extraction_method,
          schemaVersion: e.schema_version,
          createdAt: '',
          updatedAt: '',
        }))
      ) : [];

  const formsList =
    selectedType === 'insurance_form' && selectedInsurer !== null
      ? entriesForType.filter((e) => (e.insurance_company_id ?? '') === selectedInsurer)
      : selectedType && selectedType !== 'insurance_form'
        ? entriesForType
        : [];

  const goTypes = () => {
    setStep('types');
    setSelectedType(null);
    setSelectedInsurer(null);
  };

  const pickType = (t: PdfDocumentType) => {
    setSelectedType(t);
    if (t === 'insurance_form') {
      setStep('insurers');
      setSelectedInsurer(null);
    } else {
      setStep('forms');
      setSelectedInsurer(null);
    }
  };

  const pickInsurer = (key: string) => {
    setSelectedInsurer(key);
    setStep('forms');
  };

  const handleImport = async (pdfHash: string) => {
    setBusyHash(pdfHash);
    try {
      const { template, pdfPending } = await importSharedForm(pdfHash);
      onToast?.(
        pdfPending
          ? `"${template.displayName}" added — attach the blank PDF once to finish.`
          : `"${template.displayName}" added to your library.`,
        'success'
      );
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Import failed', 'error');
    } finally {
      setBusyHash(null);
    }
  };

  const handleImportPack = async () => {
    if (!selectedInsurer || selectedType !== 'insurance_form') return;
    const id = selectedInsurer || INSURANCE_COMPANIES[0]?.id;
    if (!id) return;
    setPackLoading(true);
    try {
      const { importedCount } = await importSharedFormPack({
        documentType: 'insurance_form',
        insuranceCompanyId: id,
      });
      onToast?.(`Added ${importedCount} form layout${importedCount === 1 ? '' : 's'} to your library.`, 'success');
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Pack import failed', 'error');
    } finally {
      setPackLoading(false);
    }
  };

  const triggerAttach = (pdfHash: string) => {
    setAttachHash(pdfHash);
    attachInputRef.current?.click();
  };

  const onAttachFile = async (file: File) => {
    if (!attachHash) return;
    try {
      const fileData = await fileToBase64(file);
      await attachSharedFormPdf(attachHash, { fileName: file.name, fileData });
      onToast?.('Blank PDF attached — form is ready to use.', 'success');
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Attach failed', 'error');
    } finally {
      setAttachHash(null);
    }
  };

  const breadcrumb = () => {
    const parts = ['Shared Forms'];
    if (selectedType) parts.push(PDF_DOCUMENT_TYPE_LABELS[selectedType]);
    if (selectedType === 'insurance_form' && selectedInsurer !== null) {
      parts.push(insurerGroupLabel(selectedInsurer));
    }
    return parts;
  };

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
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-indigo-100 flex items-center justify-center">
            <Globe className="h-5 w-5 text-indigo-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Shared Forms</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Layouts shared by clinicians on Halo — add to your library without re-extracting fields.
            </p>
          </div>
        </header>

        <nav className="text-xs text-slate-500 flex flex-wrap items-center gap-1">
          {breadcrumb().map((label, i) => (
            <React.Fragment key={label}>
              {i > 0 && <span className="text-slate-300">›</span>}
              <button
                type="button"
                className={i === breadcrumb().length - 1 ? 'font-semibold text-slate-700' : 'hover:text-cyan-700'}
                onClick={() => {
                  if (i === 0) goTypes();
                  else if (i === 1 && selectedType) pickType(selectedType);
                }}
              >
                {label}
              </button>
            </React.Fragment>
          ))}
        </nav>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-sm text-slate-500 rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center">
            No shared forms in the network yet. Save templates from Form Studio or Template Library
            (shared by default) to contribute.
          </p>
        ) : step === 'types' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {typesWithEntries.map((documentType) => {
              const Icon = PDF_DOCUMENT_TYPE_ICONS[documentType];
              const count = countByType.get(documentType) ?? 0;
              return (
                <button
                  key={documentType}
                  type="button"
                  onClick={() => pickType(documentType)}
                  className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-cyan-200 hover:shadow-md transition"
                >
                  <div
                    className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${documentTypeIconClass(documentType)}`}
                  >
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-900">
                      {PDF_DOCUMENT_TYPE_LABELS[documentType]}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {count} shared form{count === 1 ? '' : 's'}
                    </div>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-300 shrink-0" />
                </button>
              );
            })}
          </div>
        ) : step === 'insurers' && selectedType === 'insurance_form' ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {insurerKeys.map((key) => {
                const count = entriesForType.filter((e) => (e.insurance_company_id ?? '') === key).length;
                const label = insurerGroupLabel(key);
                return (
                  <button
                    key={key || 'uncategorized'}
                    type="button"
                    onClick={() => pickInsurer(key)}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm hover:border-cyan-200"
                  >
                    <div>
                      <div className="font-semibold text-slate-900">{label}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {count} form{count === 1 ? '' : 's'}
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-slate-300" />
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            {selectedType === 'insurance_form' && selectedInsurer !== null && (
              <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-700">
                  {insurerGroupLabel(selectedInsurer)}
                </p>
                {selectedInsurer && (
                  <button
                    type="button"
                    disabled={packLoading}
                    onClick={() => void handleImportPack()}
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {packLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Package className="h-3.5 w-3.5" />
                    )}
                    Add entire {getInsuranceCompanyLabel(selectedInsurer) ?? 'scheme'} pack
                  </button>
                )}
              </div>
            )}
            <ul className="divide-y divide-slate-100">
              {formsList.map((e) => (
                <li key={e.pdf_hash} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{e.display_name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {e.extraction_method} · {e.contributor_count} practice
                      {e.contributor_count === 1 ? '' : 's'} shared
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyHash === e.pdf_hash}
                    onClick={() => void handleImport(e.pdf_hash)}
                    className="inline-flex items-center gap-1.5 shrink-0 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                  >
                    {busyHash === e.pdf_hash ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    Add to library
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};
