import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchPdfExtractionEstimate,
  type PdfExtractionFlow,
} from '../services/api';
import { fileToBase64 } from '../form-intelligence/utils/pdfFile';
import { formatExtractionRemainingLabel } from '../utils/formatExtractionRemaining';

const DEFAULT_PADDED_MS: Record<PdfExtractionFlow, number> = {
  extract_api: 135_000,
  template_upload: 180_000,
};

export interface PdfExtractionProgressState {
  active: boolean;
  fileName: string | null;
  remainingLabel: string;
  progressPercent: number;
  paddedDurationMs: number;
}

const idleState: PdfExtractionProgressState = {
  active: false,
  fileName: null,
  remainingLabel: '',
  progressPercent: 0,
  paddedDurationMs: 0,
};

export function usePdfExtractionProgress(flow: PdfExtractionFlow) {
  const [state, setState] = useState<PdfExtractionProgressState>(idleState);
  const startedAtRef = useRef<number | null>(null);
  const paddedMsRef = useRef(0);

  const tick = useCallback(() => {
    const startedAt = startedAtRef.current;
    const padded = paddedMsRef.current;
    if (startedAt == null || padded <= 0) return;

    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, padded - elapsed);
    const overtime = elapsed >= padded;
    const progressPercent = Math.min(95, (elapsed / padded) * 100);

    setState((prev) => ({
      ...prev,
      remainingLabel: formatExtractionRemainingLabel(remaining, overtime),
      progressPercent,
    }));
  }, []);

  useEffect(() => {
    if (!state.active) return;
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [state.active, tick]);

  const reset = useCallback(() => {
    startedAtRef.current = null;
    paddedMsRef.current = 0;
    setState(idleState);
  }, []);

  const runWithFile = useCallback(
    async <T,>(file: File, work: (fileData: string) => Promise<T>): Promise<T> => {
      const fallbackPadded = DEFAULT_PADDED_MS[flow];
      paddedMsRef.current = fallbackPadded;
      startedAtRef.current = null;

      setState({
        active: true,
        fileName: file.name,
        remainingLabel: formatExtractionRemainingLabel(fallbackPadded, false),
        progressPercent: 0,
        paddedDurationMs: fallbackPadded,
      });

      const estimatePromise = fetchPdfExtractionEstimate({
        fileSizeBytes: file.size,
        flow,
      }).catch(() => null);

      const fileDataPromise = fileToBase64(file);

      const [estimate, fileData] = await Promise.all([estimatePromise, fileDataPromise]);

      const padded = estimate?.paddedDurationMs ?? fallbackPadded;
      paddedMsRef.current = padded;
      startedAtRef.current = Date.now();

      setState((prev) => ({
        ...prev,
        paddedDurationMs: padded,
        remainingLabel: formatExtractionRemainingLabel(padded, false),
        progressPercent: 0,
      }));

      try {
        return await work(fileData);
      } finally {
        reset();
      }
    },
    [flow, reset]
  );

  return { progress: state, runWithFile, reset };
}
