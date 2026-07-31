import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchApprovedBeamerAssets, type BeamerAsset } from '../../services/api';

export interface BeamerAssetsState {
  assets: BeamerAsset[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Patient-scoped Beamer assets for downstream clinical workflows.
 * The API request explicitly asks for approved assets, and the hook filters again
 * so review-queue items can never leak into a consumer such as Scopes.
 */
export function useBeamerAssets(patientId: string | null | undefined): BeamerAssetsState {
  const [assets, setAssets] = useState<BeamerAsset[]>([]);
  const [loading, setLoading] = useState(Boolean(patientId));
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!patientId) {
      setAssets([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetchApprovedBeamerAssets(patientId);
      if (requestId !== requestIdRef.current) return;
      setAssets((response.assets || []).filter((asset) => asset.status === 'approved' && asset.patientId === patientId));
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setAssets([]);
      setError(caught instanceof Error ? caught.message : 'Beamer images could not be loaded.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return { assets, loading, error, refresh };
}
