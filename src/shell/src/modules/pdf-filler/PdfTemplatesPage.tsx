import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileStack, Loader2, Trash2, Upload } from 'lucide-react';
import {
  PDF_DOCUMENT_TYPES,
  PDF_DOCUMENT_TYPE_LABELS,
  type PdfDocumentType,
  type PdfTemplateManifestEntry,
} from '../../../../../shared/pdfFiller';
import { deletePdfTemplate, fetchPdfTemplates, uploadPdfTemplate } from './services/api';

type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;

interface PdfTemplatesPageProps {
  onToast?: ToastFn;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export const PdfTemplatesPage: React.FC<PdfTemplatesPageProps> = ({ onToast }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<PdfTemplateManifestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [documentType, setDocumentType] = useState<PdfDocumentType>('insurance_form');
  const [displayName, setDisplayName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      onToast?.('Please upload a PDF file.', 'error');
      return;
    }
    setUploading(true);
    try {
      const fileData = await fileToBase64(file);
      const { template } = await uploadPdfTemplate({
        fileName: file.name,
        fileData,
        documentType,
        displayName: displayName.trim() || undefined,
      });
      onToast?.(`Template "${template.displayName}" saved to Practice Admin/PDF Documents`, 'success');
      setDisplayName('');
      await refresh();
    } catch (e) {
      onToast?.(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
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

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50 p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-8">
        <header>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-cyan-100 flex items-center justify-center">
              <FileStack className="h-5 w-5 text-cyan-700" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">PDF Templates</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Upload forms once. Stored on Drive under Practice Admin / PDF Documents. Patients complete them in Halo UI.
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
              <label className="block text-xs font-medium text-slate-500 mb-1">Display name (optional)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Chronic Illness Application"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing & saving…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Choose PDF
              </>
            )}
          </button>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Saved templates</h2>
          </div>
          {loading ? (
            <div className="p-8 flex justify-center text-slate-500 text-sm">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No templates uploaded yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {templates.map((t) => (
                <li key={t.templateId} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 truncate">{t.displayName}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {PDF_DOCUMENT_TYPE_LABELS[t.documentType]} · {t.extractionMethod} · updated{' '}
                      {new Date(t.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={deletingId === t.templateId}
                    onClick={() => void handleDelete(t.templateId)}
                    className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                    title="Remove from library"
                  >
                    {deletingId === t.templateId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
};
