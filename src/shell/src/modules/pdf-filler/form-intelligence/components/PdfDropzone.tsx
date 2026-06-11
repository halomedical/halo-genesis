import React, { useCallback, useRef, useState } from 'react';
import { FileUp, Loader2 } from 'lucide-react';

interface PdfDropzoneProps {
  disabled?: boolean;
  loading?: boolean;
  onFile: (file: File) => void;
}

export const PdfDropzone: React.FC<PdfDropzoneProps> = ({ disabled, loading, onFile }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const acceptFile = useCallback(
    (file: File | undefined) => {
      if (!file || disabled || loading) return;
      if (!file.name.toLowerCase().endsWith('.pdf')) return;
      onFile(file);
    },
    [disabled, loading, onFile]
  );

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled && !loading) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        acceptFile(e.dataTransfer.files?.[0]);
      }}
      onClick={() => !disabled && !loading && inputRef.current?.click()}
      className={`rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors cursor-pointer ${
        dragOver
          ? 'border-indigo-400 bg-indigo-50/50'
          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80'
      } ${disabled || loading ? 'opacity-60 pointer-events-none' : ''}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          acceptFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <div className="flex flex-col items-center gap-2 text-slate-600">
        {loading ? (
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        ) : (
          <FileUp className="h-8 w-8 text-slate-400" />
        )}
        <p className="text-sm font-medium text-slate-800">
          {loading ? 'Analyzing PDF…' : 'Drop a blank PDF here'}
        </p>
        <p className="text-xs text-slate-500">or click to browse</p>
      </div>
    </div>
  );
};
