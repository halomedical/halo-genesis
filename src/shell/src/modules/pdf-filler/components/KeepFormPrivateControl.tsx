import React, { useState } from 'react';
import { Lock } from 'lucide-react';

interface KeepFormPrivateControlProps {
  keepPrivate: boolean;
  onChange: (keepPrivate: boolean) => void;
  className?: string;
}

export const KeepFormPrivateControl: React.FC<KeepFormPrivateControlProps> = ({
  keepPrivate,
  onChange,
  className = '',
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const requestPrivate = () => {
    if (keepPrivate) {
      onChange(false);
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <>
      <label
        className={`flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 cursor-pointer ${className}`}
      >
        <input
          type="checkbox"
          checked={keepPrivate}
          onChange={() => requestPrivate()}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-slate-900"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <Lock className="h-4 w-4 text-slate-500" />
            Keep this form private
          </span>
          <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
            By default, layouts are shared with the Halo network so colleagues can add them without
            re-scanning. Private forms stay on your Drive only.
          </span>
        </span>
      </label>

      {confirmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-slate-200 p-6 space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Keep this form private?</h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Private forms stay on your Drive only. Other clinicians won&apos;t be able to add this
              layout to their library, and we can&apos;t grow shared coverage for this scheme
              together.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange(true);
                  setConfirmOpen(false);
                }}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Yes, keep private
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
