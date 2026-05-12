import type { Patient, HaloNote } from '../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    },
  });

  if (res.status === 401) {
    throw new ApiError('Not authenticated', 401);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new ApiError(`Server error (${res.status}). ${text || 'Please try again.'}`, res.status);
  }

  if (!res.ok) {
    const message = (data as { error?: string }).error || `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

// --- Auth ---
export const getLoginUrl = () => request<{ url: string }>('/api/auth/login-url');
export const checkAuth = () => request<{ signedIn: boolean; email?: string }>('/api/auth/me');
export const logout = () => request('/api/auth/logout', { method: 'POST' });

// --- Patients ---
interface PatientsResponse {
  patients: Patient[];
  nextPage: string | null;
}

export const fetchPatients = (page?: string): Promise<PatientsResponse> => {
  const params = new URLSearchParams();
  params.set('pageSize', '100');
  if (page) params.set('page', page);
  return request<PatientsResponse>(`/api/drive/patients?${params.toString()}`);
};

export async function fetchAllPatients(): Promise<Patient[]> {
  const all: Patient[] = [];
  let page: string | undefined;
  do {
    const data = await fetchPatients(page);
    all.push(...data.patients);
    page = data.nextPage ?? undefined;
  } while (page);
  return all;
}

// --- Transcribe ---
export const transcribeAudio = async (audioBase64: string, mimeType: string): Promise<string> => {
  const data = await request<{ transcript: string }>('/api/ai/transcribe', {
    method: 'POST',
    body: JSON.stringify({ audioBase64, mimeType }),
  });
  return data.transcript ?? '';
};

// --- Halo (mobile: fixed user_id / template_id from server) ---
/** Generate note preview (return_type=note). Mobile uses server-side mobile Halo config for user_id/template_id when not passed. */
export const generateNotePreview = (params: { text: string; user_id?: string; template_id?: string }) =>
  request<{ notes: HaloNote[] }>('/api/halo/generate-note', {
    method: 'POST',
    body: JSON.stringify({ ...params, return_type: 'note' }),
  });

/** Confirm and send: generate DOCX, save to patient folder, email to signed-in user. */
export const confirmAndSendNote = (params: {
  patientId: string;
  text: string;
  fileName?: string;
  patientName?: string;
}) =>
  request<{ success: boolean; fileId: string; name: string; emailSent: boolean }>(
    '/api/halo/confirm-and-send',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
