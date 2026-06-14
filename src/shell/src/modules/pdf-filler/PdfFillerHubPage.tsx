import React, { useState } from 'react';
import { FileStack, Globe, LayoutTemplate } from 'lucide-react';
import { FormIntelligencePage } from './form-intelligence/FormIntelligencePage';
import { PdfTemplatesPage } from './PdfTemplatesPage';
import { SharedFormsPage } from './SharedFormsPage';

type HubTab = 'form-studio' | 'template-library' | 'shared-forms';
type ToastFn = (message: string, type: 'success' | 'error' | 'info') => void;

interface PdfFillerHubPageProps {
  onToast?: ToastFn;
}

export const PdfFillerHubPage: React.FC<PdfFillerHubPageProps> = ({ onToast }) => {
  const [tab, setTab] = useState<HubTab>('form-studio');
  const [studioLoadTemplateId, setStudioLoadTemplateId] = useState<string | null>(null);

  const openInStudio = (templateId: string) => {
    setStudioLoadTemplateId(templateId);
    setTab('form-studio');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 md:px-6">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTab('form-studio')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
              tab === 'form-studio'
                ? 'border-cyan-600 text-cyan-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <LayoutTemplate className="h-4 w-4" />
            Form Studio
          </button>
          <button
            type="button"
            onClick={() => setTab('template-library')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
              tab === 'template-library'
                ? 'border-cyan-600 text-cyan-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <FileStack className="h-4 w-4" />
            Template Library
          </button>
          <button
            type="button"
            onClick={() => setTab('shared-forms')}
            className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition ${
              tab === 'shared-forms'
                ? 'border-cyan-600 text-cyan-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            <Globe className="h-4 w-4" />
            Shared Forms
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'form-studio' ? (
          <FormIntelligencePage
            onToast={onToast}
            initialTemplateId={studioLoadTemplateId}
            onInitialTemplateLoaded={() => setStudioLoadTemplateId(null)}
          />
        ) : tab === 'template-library' ? (
          <PdfTemplatesPage onToast={onToast} onOpenInStudio={openInStudio} />
        ) : (
          <SharedFormsPage onToast={onToast} />
        )}
      </div>
    </div>
  );
};
