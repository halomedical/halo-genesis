import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PdfPageFooterProps {
  currentPage: number;
  numPages: number;
  onPageChange: (page: number) => void;
}

export const PdfPageFooter: React.FC<PdfPageFooterProps> = ({
  currentPage,
  numPages,
  onPageChange,
}) => {
  if (numPages <= 0) return null;

  return (
    <div className="sticky bottom-0 flex items-center justify-center gap-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </button>
      <span className="text-sm font-medium text-slate-600 tabular-nums">
        Page {currentPage} of {numPages}
      </span>
      <button
        type="button"
        disabled={currentPage >= numPages}
        onClick={() => onPageChange(currentPage + 1)}
        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
};
