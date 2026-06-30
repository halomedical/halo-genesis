export type PollableJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface PollableJob {
  status: PollableJobStatus;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function pollJobUntilComplete<TJob extends PollableJob>(params: {
  initialJob: TJob;
  fetchJob: () => Promise<TJob>;
  onUpdate?: (job: TJob) => void;
  shouldContinue?: () => boolean;
  intervalMs?: number;
  timeoutMs?: number;
}): Promise<TJob | null> {
  const intervalMs = params.intervalMs ?? 1500;
  const timeoutMs = params.timeoutMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();
  let job = params.initialJob;
  params.onUpdate?.(job);

  while (job.status === 'queued' || job.status === 'running') {
    if (params.shouldContinue && !params.shouldContinue()) return null;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Job is still running. Please check again shortly.');
    }
    await delay(intervalMs);
    if (params.shouldContinue && !params.shouldContinue()) return null;
    job = await params.fetchJob();
    params.onUpdate?.(job);
  }

  return job;
}
