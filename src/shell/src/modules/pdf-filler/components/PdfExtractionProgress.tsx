import React from 'react';
import { Loader2 } from 'lucide-react';

interface PdfExtractionProgressProps {
  active: boolean;
  fileName?: string | null;
  phaseLabel: string;
  remainingLabel: string;
  progressPercent: number;
}

export const PdfExtractionProgress: React.FC<PdfExtractionProgressProps> = ({
  active,
  fileName,
  phaseLabel,
  remainingLabel,
  progressPercent,
}) => {
  if (!active) return null;

  return (
    <div
      className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-4 py-3 space-y-2"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-600 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">{phaseLabel}</p>
          {fileName ? (
            <p className="text-xs text-slate-500 truncate" title={fileName}>
              {fileName}
            </p>
          ) : null}
          <p className="text-xs font-medium text-indigo-700 mt-1">{remainingLabel}</p>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-indigo-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width] duration-1000 ease-linear"
          style={{ width: `${Math.max(2, progressPercent)}%` }}
        />
      </div>
    </div>
  );
};
