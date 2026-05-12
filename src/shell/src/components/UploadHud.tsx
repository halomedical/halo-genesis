import React from 'react';
import { CheckCircle2, CloudUpload, Loader2 } from 'lucide-react';

export interface UploadHudState {
  phase: 'uploading' | 'processing' | 'success';
  title: string;
  detail?: string;
  progress: number;
}

interface Props {
  state: UploadHudState;
}

export const UploadHud: React.FC<Props> = ({ state }) => {
  const progress = Math.max(0, Math.min(100, state.progress));
  const isSuccess = state.phase === 'success';
  const isProcessing = state.phase === 'processing';

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-[95] animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="w-[320px] rounded-2xl border border-slate-200 bg-white/96 px-4 py-3 shadow-[0_20px_45px_-30px_rgba(15,23,42,0.55)] backdrop-blur-sm">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
              isSuccess ? 'bg-emerald-50 text-emerald-600' : 'bg-cyan-50 text-cyan-600'
            }`}
          >
            {isSuccess ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : isProcessing ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <CloudUpload className="h-5 w-5" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-slate-800">
                {state.title}
              </p>
              <span className="shrink-0 text-xs font-semibold text-slate-400">
                {isSuccess ? 'Done' : `${progress}%`}
              </span>
            </div>

            {state.detail && (
              <p className="mt-1 text-xs text-slate-500">{state.detail}</p>
            )}

            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  isSuccess ? 'bg-emerald-500' : 'bg-cyan-500'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
