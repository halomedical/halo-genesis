import { useCallback, useEffect, useRef, useState } from 'react';
import type { PdfDocumentType } from '../../../../../../shared/pdfFiller';
import { fetchPdfExtractionEstimate, uploadPdfTemplate } from '../services/api';
import { fileToBase64 } from '../form-intelligence/utils/pdfFile';
import { formatExtractionRemainingLabel } from '../utils/formatExtractionRemaining';

const CONCURRENCY = 2;
const DEFAULT_PADDED_MS = 180_000;

export type TemplateUploadJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface TemplateUploadJob {
  id: string;
  fileName: string;
  status: TemplateUploadJobStatus;
  progressPercent: number;
  remainingLabel: string;
  error?: string;
  templateId?: string;
}

export interface EnqueueTemplateUploadParams {
  files: File[];
  documentType: PdfDocumentType;
  insuranceCompanyId?: string;
  displayName: string;
  keepPrivate?: boolean;
}

function displayNameForFile(file: File, batchDisplayName: string, batchSize: number): string {
  const stem = file.name.replace(/\.pdf$/i, '').trim() || file.name;
  const trimmed = batchDisplayName.trim();
  if (!trimmed) return stem;
  if (batchSize === 1) return trimmed;
  return `${trimmed} — ${stem}`;
}

type QueueItem = {
  id: string;
  file: File;
  documentType: PdfDocumentType;
  insuranceCompanyId?: string;
  displayName: string;
  keepPrivate?: boolean;
};

export function useTemplateUploadQueue(onJobFinished?: () => void) {
  const [jobs, setJobs] = useState<TemplateUploadJob[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  const activeCountRef = useRef(0);
  const tickersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const startedAtRef = useRef<Map<string, { startedAt: number; paddedMs: number }>>(new Map());
  const onJobFinishedRef = useRef(onJobFinished);
  onJobFinishedRef.current = onJobFinished;

  const clearTicker = useCallback((jobId: string) => {
    const intervalId = tickersRef.current.get(jobId);
    if (intervalId != null) {
      window.clearInterval(intervalId);
      tickersRef.current.delete(jobId);
    }
    startedAtRef.current.delete(jobId);
  }, []);

  const updateJob = useCallback((jobId: string, patch: Partial<TemplateUploadJob>) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...patch } : j)));
  }, []);

  const startProgressTicker = useCallback(
    (jobId: string, paddedMs: number) => {
      clearTicker(jobId);
      const startedAt = Date.now();
      startedAtRef.current.set(jobId, { startedAt, paddedMs });

      const tick = () => {
        const meta = startedAtRef.current.get(jobId);
        if (!meta) return;
        const elapsed = Date.now() - meta.startedAt;
        const remaining = Math.max(0, meta.paddedMs - elapsed);
        const overtime = elapsed >= meta.paddedMs;
        updateJob(jobId, {
          progressPercent: Math.min(95, (elapsed / meta.paddedMs) * 100),
          remainingLabel: formatExtractionRemainingLabel(remaining, overtime),
        });
      };
      tick();
      tickersRef.current.set(jobId, window.setInterval(tick, 1000));
    },
    [clearTicker, updateJob]
  );

  const runOne = useCallback(async () => {
    const next = queueRef.current.shift();
    if (!next) return;

    activeCountRef.current += 1;
    const { id, file, documentType, insuranceCompanyId, displayName } = next;

    updateJob(id, {
      status: 'running',
      progressPercent: 0,
      remainingLabel: formatExtractionRemainingLabel(DEFAULT_PADDED_MS, false),
    });

    try {
      const estimate = await fetchPdfExtractionEstimate({
        fileSizeBytes: file.size,
        flow: 'template_upload',
      }).catch(() => null);
      const paddedMs = estimate?.paddedDurationMs ?? DEFAULT_PADDED_MS;
      startProgressTicker(id, paddedMs);

      const fileData = await fileToBase64(file);
      const { template } = await uploadPdfTemplate({
        fileName: file.name,
        fileData,
        documentType,
        displayName,
        insuranceCompanyId,
        keepPrivate: next.keepPrivate,
      });

      clearTicker(id);
      updateJob(id, {
        status: 'done',
        progressPercent: 100,
        remainingLabel: 'Complete',
        templateId: template.templateId,
      });
      onJobFinishedRef.current?.();
    } catch (e) {
      clearTicker(id);
      updateJob(id, {
        status: 'error',
        error: e instanceof Error ? e.message : 'Upload failed',
        remainingLabel: '',
      });
    } finally {
      activeCountRef.current -= 1;
      while (activeCountRef.current < CONCURRENCY && queueRef.current.length > 0) {
        void runOne();
      }
    }
  }, [clearTicker, startProgressTicker, updateJob]);

  const enqueue = useCallback(
    (params: EnqueueTemplateUploadParams) => {
      const pdfs = params.files.filter((f) => f.name.toLowerCase().endsWith('.pdf'));
      if (pdfs.length === 0) return 0;

      const newJobs: TemplateUploadJob[] = pdfs.map((file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        status: 'queued',
        progressPercent: 0,
        remainingLabel: 'Waiting…',
      }));

      setJobs((prev) => [...newJobs, ...prev]);

      for (let i = 0; i < pdfs.length; i++) {
        queueRef.current.push({
          id: newJobs[i].id,
          file: pdfs[i],
          documentType: params.documentType,
          insuranceCompanyId: params.insuranceCompanyId,
          displayName: displayNameForFile(pdfs[i], params.displayName, pdfs.length),
          keepPrivate: params.keepPrivate,
        });
      }

      while (activeCountRef.current < CONCURRENCY && queueRef.current.length > 0) {
        void runOne();
      }
      return pdfs.length;
    },
    [runOne]
  );

  const dismissCompleted = useCallback(() => {
    setJobs((prev) => prev.filter((j) => j.status !== 'done' && j.status !== 'error'));
  }, []);

  useEffect(() => {
    return () => {
      for (const id of tickersRef.current.keys()) {
        clearTicker(id);
      }
    };
  }, [clearTicker]);

  const hasActive = jobs.some((j) => j.status === 'queued' || j.status === 'running');

  return { jobs, enqueue, dismissCompleted, hasActive };
}
