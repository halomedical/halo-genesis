import React from 'react';
import { Check, FileImage, Images, Loader2, RefreshCw } from 'lucide-react';
import type { BeamerAsset } from '../../services/api';
import { useBeamerAssets } from './useBeamerAssets';

interface BeamerAssetPickerProps {
  patientId: string;
  selectedAssetIds: string[];
  onSelectionChange: (assetIds: string[], assets: BeamerAsset[]) => void;
  maxSelection?: number;
  className?: string;
}

function formatCapturedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Capture time unavailable';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

/**
 * Drop-in image browser for Scopes. It exposes opaque Beamer asset IDs and safe
 * preview URLs only; original filenames and review-queue items are never shown.
 */
export const BeamerAssetPicker: React.FC<BeamerAssetPickerProps> = ({
  patientId,
  selectedAssetIds,
  onSelectionChange,
  maxSelection,
  className = '',
}) => {
  const { assets, loading, error, refresh } = useBeamerAssets(patientId);
  const selected = new Set(selectedAssetIds);

  const toggleAsset = (asset: BeamerAsset) => {
    const nextIds = selected.has(asset.id)
      ? selectedAssetIds.filter((id) => id !== asset.id)
      : [...selectedAssetIds, asset.id];
    if (!selected.has(asset.id) && maxSelection && nextIds.length > maxSelection) return;
    const byId = new Map(assets.map((item) => [item.id, item]));
    onSelectionChange(nextIds, nextIds.map((id) => byId.get(id)).filter((item): item is BeamerAsset => Boolean(item)));
  };

  return (
    <section className={`overflow-hidden rounded-2xl border border-slate-200 bg-white ${className}`} aria-label="Beamer uploads">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800"><Images size={16} className="text-cyan-600" />Beamer uploads</h3>
          <p className="mt-0.5 text-xs text-slate-500">Approved images for this patient</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Refresh Beamer uploads" className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-cyan-700 disabled:opacity-50">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-400"><Loader2 size={17} className="animate-spin" />Loading approved images…</div>
      ) : error ? (
        <div className="px-4 py-8 text-center"><p className="text-sm text-rose-600">{error}</p><button type="button" onClick={() => void refresh()} className="mt-3 text-xs font-bold text-cyan-700">Try again</button></div>
      ) : assets.length === 0 ? (
        <div className="px-4 py-10 text-center"><FileImage className="mx-auto text-slate-300" size={26} /><p className="mt-2 text-sm font-medium text-slate-500">No approved Beamer images</p><p className="mt-1 text-xs text-slate-400">Items awaiting review do not appear here.</p></div>
      ) : (
        <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => {
            const isSelected = selected.has(asset.id);
            const selectionBlocked = Boolean(maxSelection && selected.size >= maxSelection && !isSelected);
            return (
              <button key={asset.id} type="button" onClick={() => toggleAsset(asset)} disabled={selectionBlocked} aria-pressed={isSelected} className={`group overflow-hidden rounded-xl border text-left transition ${isSelected ? 'border-cyan-500 ring-2 ring-cyan-100' : 'border-slate-200 hover:border-cyan-300'} disabled:cursor-not-allowed disabled:opacity-50`}>
                <div className="relative aspect-square bg-slate-100">
                  {(asset.thumbnailUrl || asset.previewUrl) ? <img src={asset.thumbnailUrl || asset.previewUrl || ''} alt="Approved medical image" className="h-full w-full object-cover" loading="lazy" /> : <div className="flex h-full items-center justify-center"><FileImage className="text-slate-300" size={28} /></div>}
                  {isSelected && <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-600 text-white shadow"><Check size={14} /></span>}
                </div>
                <div className="p-2.5"><p className="truncate text-[11px] font-semibold text-slate-600">{formatCapturedAt(asset.capturedAt)}</p><p className="mt-0.5 text-[10px] capitalize text-slate-400">{asset.source}</p></div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
};
