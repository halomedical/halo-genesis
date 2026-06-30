import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface StoredJob<TInput = unknown, TResult = unknown> {
  id: string;
  type: string;
  status: JobStatus;
  phase: string;
  progress: number;
  message: string;
  input: TInput;
  actor: {
    email: string;
    name: string;
  };
  result: TResult | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type JobPatch<TResult = unknown> = Partial<
  Pick<StoredJob<unknown, TResult>, 'status' | 'phase' | 'progress' | 'message' | 'result' | 'error' | 'completedAt'>
>;

const JOBS_DIR = path.join(process.cwd(), 'data', 'jobs');
const JOB_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function ensureJobsDir(): void {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function jobPath(jobId: string): string {
  return path.join(JOBS_DIR, `${jobId}.json`);
}

function isSafeJobId(jobId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(jobId);
}

function writeJob(job: StoredJob): StoredJob {
  ensureJobsDir();
  fs.writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2));
  return job;
}

export function cleanupOldJobs(now = Date.now()): void {
  ensureJobsDir();
  for (const entry of fs.readdirSync(JOBS_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const fullPath = path.join(JOBS_DIR, entry);
    try {
      const raw = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as Partial<StoredJob>;
      const updatedAt = raw.updatedAt ? new Date(raw.updatedAt).getTime() : 0;
      if (updatedAt && now - updatedAt > JOB_RETENTION_MS) {
        fs.unlinkSync(fullPath);
      }
    } catch {
      // Keep unreadable files for manual inspection rather than deleting unknown data.
    }
  }
}

export function createJob<TInput>(
  type: string,
  input: TInput,
  actor: StoredJob['actor']
): StoredJob<TInput> {
  cleanupOldJobs();
  const now = new Date().toISOString();
  const job: StoredJob<TInput> = {
    id: crypto.randomUUID(),
    type,
    status: 'queued',
    phase: 'queued',
    progress: 0,
    message: 'Queued.',
    input,
    actor,
    result: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
  return writeJob(job) as StoredJob<TInput>;
}

export function getJob<TInput = unknown, TResult = unknown>(jobId: string): StoredJob<TInput, TResult> | null {
  if (!isSafeJobId(jobId)) return null;
  try {
    const raw = fs.readFileSync(jobPath(jobId), 'utf8');
    return JSON.parse(raw) as StoredJob<TInput, TResult>;
  } catch {
    return null;
  }
}

export function updateJob<TResult = unknown>(jobId: string, patch: JobPatch<TResult>): StoredJob<unknown, TResult> {
  const existing = getJob<unknown, TResult>(jobId);
  if (!existing) {
    throw new Error(`Job not found: ${jobId}`);
  }

  const next: StoredJob<unknown, TResult> = {
    ...existing,
    ...patch,
    progress: Math.max(0, Math.min(100, patch.progress ?? existing.progress)),
    updatedAt: new Date().toISOString(),
  };

  if ((next.status === 'succeeded' || next.status === 'failed') && !next.completedAt) {
    next.completedAt = next.updatedAt;
  }

  return writeJob(next) as StoredJob<unknown, TResult>;
}
