import { normalizeUserSettings } from '../../../../shared/types';
import type { EffectiveFeatureFlags } from '../../../../shared/featureFlags';
import type { PdfDocumentType, PdfTemplateManifestEntry } from '../../../../shared/pdfFiller';
import type {
  AdmissionsBoard,
  Patient,
  DriveFile,
  LabAlert,
  ChatAttachment,
  ChatMessage,
  UserSettings,
  HaloNote,
  CalendarEvent,
  ScribeSession,
  ScribeSessionNote,
} from '../../../../shared/types';

const API_BASE = import.meta.env.VITE_API_URL || '';

/** WebSocket URL for live transcription (ws or wss).
 *
 * - In production: set VITE_API_URL to the backend origin (e.g. https://app.halo.africa)
 *   and we derive wss://.../ws/transcribe from that.
 * - In local dev (no VITE_API_URL): REST calls use Vite's /api proxy, but WebSocket
 *   needs to go directly to the Node server on port 3001.
 */
export function getTranscribeWebSocketUrl(): string {
  // If an explicit API base is configured, derive WS URL from it
  if (API_BASE) {
    const base = API_BASE.replace(/\/$/, '');
    const wsProtocol = base.startsWith('https') ? 'wss:' : 'ws:';
    const host = base.replace(/^https?:\/\//, '');
    return `${wsProtocol}//${host}/ws/transcribe`;
  }

  // Dev fallback: assume backend is on port 3001 at same host
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname;
    const port = 3001;
    return `${protocol}//${hostname}:${port}/ws/transcribe`;
  }

  // SSR / safety fallback
  return 'ws://localhost:3001/ws/transcribe';
}

// --- Structured Error ---
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
  console.log(`[API] Making request to: ${url}`);
  
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    console.error('[API] Network error:', error);
    throw new ApiError(
      `Failed to connect to server. Make sure the server is running on port 3001. ${error instanceof Error ? error.message : 'Unknown error'}`,
      0
    );
  }

  if (res.status === 401) {
    window.location.href = '/';
    throw new ApiError('Not authenticated', 401);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    const text = await res.text().catch(() => 'Unable to read response');
    console.error('[API] Non-JSON response:', text);
    throw new ApiError(
      `Server returned a non-JSON response (${res.status}). Please try again.`,
      res.status
    );
  }

  if (!res.ok) {
    const message = (data as { error?: string }).error || `Request failed (${res.status})`;
    console.error('[API] Request failed:', message);
    throw new ApiError(message, res.status);
  }

  return data as T;
}

async function requestBlob(path: string, options: RequestInit = {}): Promise<Blob> {
  const url = `${API_BASE}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    throw new ApiError(
      `Failed to connect to server. ${error instanceof Error ? error.message : 'Unknown error'}`,
      0
    );
  }

  if (res.status === 401) {
    window.location.href = '/';
    throw new ApiError('Not authenticated', 401);
  }

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    const contentType = res.headers.get('content-type') || '';
    try {
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as { error?: string };
        message = data.error || message;
      } else {
        const text = await res.text();
        if (text) message = text;
      }
    } catch {
      // Keep default message.
    }
    throw new ApiError(message, res.status);
  }

  return res.blob();
}

// --- AUTH ---
export const getLoginUrl = () => request<{ url: string }>('/api/auth/login-url');
export const checkAuth = () => request<{ signedIn: boolean; email?: string }>('/api/auth/me');
export const logout = () => request('/api/auth/logout', { method: 'POST' });
export const fetchEffectiveFeatures = () =>
  request<{ effective: EffectiveFeatureFlags }>('/api/drive/features');

/** Run note conversion scheduler now (txt→docx after 10h, docx→pdf after 24h). Requires jobs to be due. */
export const runSchedulerNow = () =>
  request<{ ok: boolean; message: string }>('/api/drive/run-scheduler', { method: 'POST' });

/** Check scheduler for pending conversion jobs */
export const getSchedulerStatus = () =>
  request<{ totalPending: number; totalDue: number; jobs: Array<{ fileId: string; status: string; savedAt: string }> }>(
    '/api/drive/scheduler-status'
  );

/** Send a new template request to admin (description + optional file attachments as base64) */
export const requestNewTemplate = (params: {
  description: string;
  attachments?: Array<{ name: string; content: string }>;
}) =>
  request<{ ok: boolean; message: string }>('/api/request-template', {
    method: 'POST',
    body: JSON.stringify(params),
  });

// --- CALENDAR / BOOKINGS ---

export const fetchTodayEvents = () =>
  request<{ events: CalendarEvent[] }>('/api/calendar/today');

export const fetchEventsInRange = (
  startIso: string,
  endIso: string,
  timeZone?: string
) => {
  const params = new URLSearchParams({
    start: startIso,
    end: endIso,
  });
  if (timeZone) params.set('timeZone', timeZone);
  return request<{ events: CalendarEvent[] }>(
    `/api/calendar/events?${params.toString()}`
  );
};

export const fetchCalendarEvent = (id: string) =>
  request<{ event: CalendarEvent }>(`/api/calendar/events/${encodeURIComponent(id)}`);

export interface CalendarEventCreatePayload {
  title: string;
  description?: string;
  start: string;
  end: string;
  timeZone?: string;
  location?: string;
  patientId?: string;
  attachmentFileIds?: string[];
}

export type CalendarEventUpdatePayload = Partial<CalendarEventCreatePayload>;

export const createCalendarEvent = (payload: CalendarEventCreatePayload) =>
  request<{ event: CalendarEvent }>('/api/calendar/events', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateCalendarEvent = (
  id: string,
  payload: CalendarEventUpdatePayload
) =>
  request<{ event: CalendarEvent }>(`/api/calendar/events/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

export const deleteCalendarEvent = (id: string) =>
  request<void>(`/api/calendar/events/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const updateCalendarEventAttachments = (id: string, fileIds: string[]) =>
  request<{ event: CalendarEvent }>(
    `/api/calendar/events/${encodeURIComponent(id)}/attachments`,
    {
      method: 'POST',
      body: JSON.stringify({ fileIds }),
    }
  );

export const generatePrepNote = (patientId: string, patientName: string) =>
  request<{ prepNote: string }>('/api/calendar/prep-note', {
    method: 'POST',
    body: JSON.stringify({ patientId, patientName }),
  });

// --- PATIENTS (paginated) ---
interface PatientsResponse {
  patients: Patient[];
  nextPage: string | null;
}

export interface PatientBillingPayload {
  medicalAid?: string;
  medicalAidPlan?: string;
  medicalAidNumber?: string;
  folderNumber?: string;
  idNumber?: string;
  schemeCode?: string;
  planCode?: string;
  memberNumber?: string;
  dependantCode?: string;
  initials?: string;
  statusIndicator?: string;
  familyGroupId?: string;
  familyName?: string;
  familyMemberIds?: string[];
}

export interface PatientCreatePayload extends PatientBillingPayload {
  name: string;
  dob: string;
  sex: 'M' | 'F';
}

export interface PatientUpdatePayload extends PatientBillingPayload {
  name?: string;
  dob?: string;
  sex?: string;
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

export const createPatient = (
  name: string,
  dob: string,
  sex: 'M' | 'F',
  extras: PatientBillingPayload = {}
) =>
  request<Patient>('/api/drive/patients', {
    method: 'POST',
    body: JSON.stringify({ name, dob, sex, ...extras }),
  });

export const updatePatient = (id: string, updates: PatientUpdatePayload) =>
  request(`/api/drive/patients/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });

export interface PatientFamilyUpdateResponse {
  success: boolean;
  familyGroupId: string | null;
  familyName: string | null;
  members: Patient[];
}

export const updatePatientFamily = (
  id: string,
  memberIds: string[],
  familyName?: string
) =>
  request<PatientFamilyUpdateResponse>(`/api/drive/patients/${id}/family`, {
    method: 'POST',
    body: JSON.stringify({ memberIds, familyName }),
  });

export const deletePatient = (id: string) =>
  request(`/api/drive/patients/${id}`, { method: 'DELETE' });

export interface PatientImportSummaryItem {
  name: string;
  memberNumber?: string;
  dependantCode?: string;
  idNumber?: string;
  reason: string;
}

export interface PatientImportResponse {
  total: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  created: PatientImportSummaryItem[];
  skipped: PatientImportSummaryItem[];
  failed: PatientImportSummaryItem[];
}

export const importPatientsJson = (payload: unknown) =>
  request<PatientImportResponse>('/api/drive/patients/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// --- SCRIBE SESSIONS (per patient) ---

export const fetchPatientSessions = (patientId: string) =>
  request<{ sessions: ScribeSession[] }>(
    `/api/drive/patients/${encodeURIComponent(patientId)}/sessions`
  );

export const savePatientSession = (
  patientId: string,
  payload: {
    sessionId?: string;
    transcript: string;
    context?: string;
    templates?: string[];
    noteTitles?: string[];
    notes?: ScribeSessionNote[];
    mainComplaint?: string;
  }
) =>
  request<{ sessions: ScribeSession[] }>(
    `/api/drive/patients/${encodeURIComponent(patientId)}/sessions`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

// --- FILES / FOLDER CONTENTS (paginated) ---
interface FilesResponse {
  files: DriveFile[];
  nextPage: string | null;
}

/** Fetch first page of files only (for fast initial render). Returns { files, nextPage }. */
export const fetchFilesFirstPage = async (
  patientId: string,
  pageSize = 100
): Promise<{ files: DriveFile[]; nextPage: string | null }> => {
  const data = await request<FilesResponse>(
    `/api/drive/patients/${patientId}/files?pageSize=${pageSize}`
  );
  return { files: data.files || [], nextPage: data.nextPage ?? null };
};

/** Warm-and-list: upload tiny temp file, get file list, server deletes temp. Makes list load reliably when plain list hangs. */
export const warmAndListFiles = async (
  patientId: string,
  pageSize = 24
): Promise<{ files: DriveFile[]; nextPage: string | null }> => {
  const data = await request<FilesResponse>(
    `/api/drive/patients/${patientId}/warm-and-list?pageSize=${pageSize}`,
    { method: 'POST' }
  );
  return { files: data.files || [], nextPage: data.nextPage ?? null };
};

/** Fetch a single page of files by token (for pagination). */
export const fetchFilesPage = async (
  patientId: string,
  pageToken: string
): Promise<{ files: DriveFile[]; nextPage: string | null }> => {
  const data = await request<FilesResponse>(
    `/api/drive/patients/${patientId}/files?pageSize=100&page=${encodeURIComponent(pageToken)}`
  );
  return { files: data.files || [], nextPage: data.nextPage ?? null };
};

/** Fetch all pages of files (can be slow for large folders). */
export const fetchFiles = async (patientId: string): Promise<DriveFile[]> => {
  const all: DriveFile[] = [];
  let page: string | undefined;

  do {
    const data = await request<FilesResponse>(
      `/api/drive/patients/${patientId}/files?pageSize=100${page ? `&page=${encodeURIComponent(page)}` : ''}`
    );
    all.push(...data.files);
    page = data.nextPage ?? undefined;
  } while (page);

  return all;
};

// Fetch contents of any folder by its Drive ID (used for subfolder navigation)
export const fetchFolderContents = async (folderId: string): Promise<DriveFile[]> => {
  const all: DriveFile[] = [];
  let page: string | undefined;

  do {
    const data = await request<FilesResponse>(
      `/api/drive/patients/${folderId}/files?pageSize=100${page ? `&page=${encodeURIComponent(page)}` : ''}`
    );
    all.push(...data.files);
    page = data.nextPage ?? undefined;
  } while (page);

  return all;
};

export const uploadFile = async (
  folderId: string,
  file: File,
  customName?: string,
  patientId?: string
): Promise<DriveFile> => {
  const base64 = await fileToBase64(file);
  return request<DriveFile>(`/api/drive/patients/${folderId}/upload`, {
    method: 'POST',
    body: JSON.stringify({
      fileName: customName || file.name,
      fileType: file.type,
      fileData: base64,
      patientId,
    }),
  });
};

export const updateFileMetadata = (_patientId: string, fileId: string, newName: string) =>
  request(`/api/drive/files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: newName }),
  });

export const deleteFile = (fileId: string) =>
  request(`/api/drive/files/${fileId}`, { method: 'DELETE' });

export const getFileDownloadUrl = (fileId: string) =>
  request<{ downloadUrl: string; viewUrl: string; name: string; mimeType: string }>(
    `/api/drive/files/${fileId}/download`
  );

export const createFolder = (parentId: string, name: string) =>
  request<DriveFile>(`/api/drive/patients/${parentId}/folder`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });

// --- AI ---
export const generatePatientSummary = async (patientName: string, files: DriveFile[], patientId?: string): Promise<string[]> => {
  return request<string[]>('/api/ai/summary', {
    method: 'POST',
    body: JSON.stringify({ patientName, patientId, files }),
  });
};

export const extractLabAlerts = async (content: string): Promise<LabAlert[]> => {
  return request<LabAlert[]>('/api/ai/lab-alerts', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
};

export const analyzeAndRenameImage = async (base64Image: string): Promise<string> => {
  const data = await request<{ filename: string }>('/api/ai/analyze-image', {
    method: 'POST',
    body: JSON.stringify({ base64Image }),
  });
  return data.filename;
};

/** Transcribe audio to text only (no SOAP/note generation). Use Halo generate_note for notes. */
export const transcribeAudio = async (audioBase64: string, mimeType: string): Promise<string> => {
  const data = await request<{ transcript: string }>('/api/ai/transcribe', {
    method: 'POST',
    body: JSON.stringify({ audioBase64, mimeType }),
  });
  return data.transcript ?? '';
};

/** Extract patient demographics from a scanned sticker/label image. */
export interface StickerExtractedData {
  fullName?: string | null;
  dob?: string | null;
  idNumber?: string | null;
  folderNumber?: string | null;
  gender?: string | null;
  contactNumber?: string | null;
  address?: string | null;
  medicalAid?: string | null;
  medicalAidNumber?: string | null;
  medicalAidPlan?: string | null;
  email?: string | null;
  notes?: string | null;
}

export const extractPatientSticker = async (
  base64Image: string,
  mimeType: string,
): Promise<StickerExtractedData> => {
  const data = await request<{ extracted: StickerExtractedData }>('/api/ai/extract-sticker', {
    method: 'POST',
    body: JSON.stringify({ base64Image, mimeType }),
  });
  return data.extracted ?? {};
};

/** Ask Gemini to describe a single uploaded file for clinical context. */
export const describeFile = async (patientId: string, file: DriveFile): Promise<string> => {
  const data = await request<{ description: string }>('/api/ai/describe-file', {
    method: 'POST',
    body: JSON.stringify({
      patientId,
      fileId: file.id,
      name: file.name,
      mimeType: file.mimeType,
    }),
  });
  return data.description ?? '';
};

export const fetchPatientSummary = (patientId: string) =>
  request<{ markdown: string; lastUpdatedAt?: string | null }>(
    `/api/drive/patients/${encodeURIComponent(patientId)}/summary`
  );

export const fetchAdmissionsBoard = () =>
  request<{ board: AdmissionsBoard }>('/api/drive/admissions-board');

export const saveAdmissionsBoard = (board: AdmissionsBoard) =>
  request<{ board: AdmissionsBoard }>('/api/drive/admissions-board', {
    method: 'PUT',
    body: JSON.stringify(board),
  });

// --- Halo API (note generation + templates) ---
export const getHaloTemplates = (userId?: string) =>
  request<Record<string, unknown>>('/api/halo/templates', {
    method: 'POST',
    body: JSON.stringify(userId ? { user_id: userId } : {}),
  });

/** Generate note preview (return_type=note). Returns normalized notes array. */
export const generateNotePreview = (params: { template_id: string; text: string; user_id?: string }) =>
  request<{ notes: HaloNote[] }>('/api/halo/generate-note', {
    method: 'POST',
    body: JSON.stringify({ ...params, return_type: 'note' }),
  });

/** Generate a PDF preview for the current note state without saving it to Drive. */
export const previewNotePdf = (params: {
  patientId: string;
  template_id: string;
  text: string;
  fileName?: string;
  user_id?: string;
}) =>
  requestBlob('/api/halo/preview-note-pdf', {
    method: 'POST',
    body: JSON.stringify(params),
  });

/** Generate DOCX and save to patient folder on Drive. Returns { success, fileId, name }. */
export const saveNoteAsDocx = (params: {
  patientId: string;
  template_id: string;
  text: string;
  fileName?: string;
  user_id?: string;
}) =>
  request<{ success: boolean; fileId: string; name: string }>('/api/halo/generate-note', {
    method: 'POST',
    body: JSON.stringify({
      template_id: params.template_id,
      text: params.text,
      return_type: 'docx',
      patientId: params.patientId,
      fileName: params.fileName,
      user_id: params.user_id,
    }),
  });

/** Email a note as DOCX to the signed-in user. Generates DOCX via Halo API and emails it. */
export const emailNoteAsDocx = (params: {
  patientId: string;
  patientName: string;
  text: string;
  fileName?: string;
}) =>
  request<{ success: boolean; fileId: string; name: string; emailSent: boolean }>('/api/halo/confirm-and-send', {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const searchPatientsByConcept = async (
  query: string,
  patients: Patient[],
  files: Record<string, DriveFile[]>
): Promise<string[]> => {
  return request<string[]>('/api/ai/search', {
    method: 'POST',
    body: JSON.stringify({ query, patients, files }),
  });
};

export const askHalo = async (
  patientId: string,
  question: string,
  history: ChatMessage[],
  attachments?: ChatAttachment[]
): Promise<{ reply: string }> => {
  return request<{ reply: string }>('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ patientId, question, history, attachments }),
  });
};

/**
 * Stream HALO chat response via SSE. Calls onChunk for each text chunk,
 * onComplete when done. Uses 90s timeout for slow Gemini responses.
 */
export const askHaloStream = async (
  patientId: string,
  question: string,
  history: ChatMessage[],
  attachments: ChatAttachment[] | undefined,
  onChunk: (text: string) => void
): Promise<void> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90_000);

  try {
    const res = await fetch(`${API_BASE}/api/ai/chat-stream`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId, question, history, attachments }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (res.status === 401) {
      window.location.href = '/';
      throw new ApiError('Not authenticated', 401);
    }

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(err.error || `Request failed (${res.status})`, res.status);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new ApiError('No response body', 500);

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data) as string;
            if (typeof parsed === 'string') onChunk(parsed);
          } catch {
            // Ignore parse errors for malformed chunks
          }
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
};

// --- SETTINGS ---
export const loadSettings = () =>
  request<{ settings: UserSettings | null }>('/api/drive/settings').then((response) => ({
    settings: normalizeUserSettings(response.settings),
  }));

export const saveSettings = (settings: UserSettings) =>
  request<{ success: boolean }>('/api/drive/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });

// --- UTILS ---
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// --- ADMIN AGENT ---

export interface AgentTask {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  dueAt?: string | null;
  category?: 'agent' | 'doctor';
  status?: 'running' | 'complete' | 'failed';
  completedAt?: string | null;
  actionUrl?: string | null;
  agentNote?: string | null;
}

export interface GmailThread {
  id: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

export interface AgentConnections {
  gmail: { connected: boolean };
  onedrive: { connected: boolean };
  whatsapp: { connected: boolean };
}

export interface MorningBrief {
  brief: string | null;
  hasNew: boolean;
  agentCount?: number;
  doctorCount?: number;
}

export const getAgentMemory = () =>
  request<{ markdown: string; fileId: string }>('/api/admin-agent/memory');

export const saveAgentMemory = (markdown: string) =>
  request<{ success: boolean }>('/api/admin-agent/memory', {
    method: 'PUT',
    body: JSON.stringify({ markdown }),
  });

export const getAgentTasks = () =>
  request<{ tasks: AgentTask[] }>('/api/admin-agent/tasks');

export const createAgentTask = (
  title: string,
  opts?: { dueAt?: string; category?: 'agent' | 'doctor'; status?: 'running' | 'complete' | 'failed'; agentNote?: string }
) =>
  request<{ task: AgentTask }>('/api/admin-agent/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, ...opts }),
  });

export const updateAgentTask = (
  id: string,
  patch: { done?: boolean; title?: string; status?: 'running' | 'complete' | 'failed'; agentNote?: string; completedAt?: string }
) =>
  request<{ task: AgentTask }>(`/api/admin-agent/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteAgentTask = (id: string) =>
  request<{ success: boolean }>(`/api/admin-agent/tasks/${id}`, { method: 'DELETE' });

export const getAgentConnections = () =>
  request<AgentConnections>('/api/admin-agent/connections');

export const getGmailThreads = (maxResults = 10) =>
  request<{ threads: GmailThread[] }>(`/api/admin-agent/gmail/threads?maxResults=${maxResults}`);

export const createGmailDraft = (to: string, subject: string, body: string) =>
  request<{ draftId: string }>('/api/admin-agent/gmail/draft', {
    method: 'POST',
    body: JSON.stringify({ to, subject, body }),
  });

// --- VPS / Onboarding ---

export const provisionVpsAccount = () =>
  request<{ provisioned: boolean; vpsJwt: string }>('/api/admin-agent/vps/provision', { method: 'POST' });

export const getAgentBillingCap = () =>
  request<{ cap: number }>('/api/admin-agent/vps/billing-cap');

export const setAgentBillingCap = (cap: number) =>
  request<{ success: boolean; cap: number }>('/api/admin-agent/vps/billing-cap', {
    method: 'PUT',
    body: JSON.stringify({ cap }),
  });

export const markAgentSetupDone = () =>
  request<{ success: boolean }>('/api/admin-agent/vps/setup-done', { method: 'POST' });

export const getOnedriveAuthUrl = () =>
  request<{ authUrl: string }>('/api/admin-agent/onedrive/auth-url');

export const getOnedriveStatus = () =>
  request<{ connected: boolean }>('/api/admin-agent/onedrive/status');

export const triggerOnedriveSetup = () =>
  request<{ success: boolean }>('/api/admin-agent/onedrive/setup', { method: 'POST' });

export const setupDriveFolders = () =>
  request<{ success: boolean; folderIds: Record<string, string> }>('/api/admin-agent/drive-folders/setup', { method: 'POST' });

export const getMorningBrief = () =>
  request<MorningBrief>('/api/admin-agent/morning-brief');

export const updateLastSeen = () =>
  request<{ success: boolean }>('/api/admin-agent/last-seen', { method: 'POST' });

// --- Tier & Usage ---

export const getAgentTier = () =>
  request<{ tier: number }>('/api/admin-agent/tier');

export const setAgentTier = (tier: number) =>
  request<{ success: boolean; tier: number }>('/api/admin-agent/tier', {
    method: 'PUT',
    body: JSON.stringify({ tier }),
  });

export const getAgentUsage = () =>
  request<{ tokens_used: number; tokens_limit: number; reset_date: string; tier: number }>('/api/admin-agent/usage');

// --- Automations ---

export interface AgentAutomation {
  id: string;
  type: 'preset' | 'custom';
  name: string;
  description: string;
  enabled: boolean;
  frequency?: string;
  trigger?: string;
  condition?: string;
  action?: string;
  lastRunAt?: string | null;
  created_at: string;
}

export const getAutomations = () =>
  request<{ automations: AgentAutomation[] }>('/api/admin-agent/automations');

export const createAutomation = (automation: Partial<AgentAutomation>) =>
  request<{ automation: AgentAutomation }>('/api/admin-agent/automations', {
    method: 'POST',
    body: JSON.stringify(automation),
  });

export const updateAutomation = (id: string, patch: Partial<AgentAutomation>) =>
  request<{ automation: AgentAutomation }>(`/api/admin-agent/automations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });

export const deleteAutomation = (id: string) =>
  request<{ success: boolean }>(`/api/admin-agent/automations/${id}`, { method: 'DELETE' });

export const createPatientSubfolders = (folderId: string) =>
  request<{ success: boolean; subfolderIds: Record<string, string> }>(`/api/admin-agent/patient-subfolders/${folderId}`, { method: 'POST' });

export interface AgentPatient {
  id: string;
  name: string;
  dob: string;
  sex: string;
}

export const searchAgentPatients = (q: string) =>
  request<{ patients: AgentPatient[] }>(`/api/admin-agent/patients/search?q=${encodeURIComponent(q)}`);

// --- Billing records per patient ---

export const fetchPatientBillingClaims = (patientId: string) =>
  request<{ claims: unknown[] }>(`/api/drive/patients/${encodeURIComponent(patientId)}/billing-claims`);

export const appendPatientBillingClaim = (patientId: string, record: unknown) =>
  request<{ claims: unknown[] }>(`/api/drive/patients/${encodeURIComponent(patientId)}/billing-claims`, {
    method: 'POST',
    body: JSON.stringify(record),
  });

export const fetchPatientBillingEligibility = (patientId: string) =>
  request<{ checks: unknown[] }>(
    `/api/drive/patients/${encodeURIComponent(patientId)}/billing-eligibility`
  );

export const appendPatientBillingEligibility = (patientId: string, record: unknown) =>
  request<{ checks: unknown[] }>(
    `/api/drive/patients/${encodeURIComponent(patientId)}/billing-eligibility`,
    {
      method: 'POST',
      body: JSON.stringify(record),
    }
  );

// --- Chat stream ---

export interface ChatFileAttachment {
  name: string;
  mimeType: string;
  base64: string;
}

export const streamAgentChat = async (
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  onChunk: (chunk: string) => void,
  attachments?: ChatFileAttachment[]
): Promise<void> => {
  const res = await fetch(`${API_BASE}/api/admin-agent/chat`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, attachments }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(err.error || `Chat failed (${res.status})`, res.status);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new ApiError('No response body', 500);
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data) as string;
            if (typeof parsed === 'string') onChunk(parsed);
          } catch { /* ignore */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
};

// --- PDF Filler (Layer C) ---

export const fetchPdfTemplates = () =>
  request<{ templates: PdfTemplateManifestEntry[] }>('/api/pdf-filler/templates');

export const fetchPdfTemplateSchema = (templateId: string) =>
  request<{ template: PdfTemplateManifestEntry; schema: Record<string, unknown> }>(
    `/api/pdf-filler/templates/${encodeURIComponent(templateId)}/schema`
  );

export const uploadPdfTemplate = (params: {
  fileName: string;
  fileData: string;
  documentType: PdfDocumentType;
  displayName?: string;
}) =>
  request<{ template: PdfTemplateManifestEntry }>('/api/pdf-filler/templates', {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const deletePdfTemplate = (templateId: string) =>
  request<{ success: boolean }>(`/api/pdf-filler/templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
  });

export const autofillPatientPdfForm = (patientId: string, params: { templateId: string }) =>
  request<{ values: Record<string, string | null> }>(
    `/api/pdf-filler/patients/${encodeURIComponent(patientId)}/autofill`,
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );

export const fillPatientPdfForm = (patientId: string, params: {
  templateId: string;
  answers: Record<string, unknown>;
  newlyAddedData?: Record<string, unknown>;
}) =>
  request<{ fileId: string; name: string; subfolder: string; templateId: string }>(
    `/api/pdf-filler/patients/${encodeURIComponent(patientId)}/fill`,
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );

export const extractPdfTemplateSchema = (params: { fileName: string; fileData: string }) =>
  request<{
    pdfHash: string;
    schema: Record<string, unknown>;
    cacheHit: boolean;
    extractionMethod: string;
    schemaVersion: number;
  }>('/api/pdf-filler/extract', {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const publishPracticePdfTemplate = (params: {
  fileName: string;
  fileData: string;
  pdfHash: string;
  schema: Record<string, unknown>;
  documentType: PdfDocumentType;
  displayName: string;
  templateId?: string;
  extractionMethod?: string;
  schemaVersion?: number;
  baselineSchema?: Record<string, unknown>;
  baselineExtractionMethod?: string;
}) =>
  request<{
    success: boolean;
    pdfHash: string;
    template: PdfTemplateManifestEntry;
    globalCacheUpdated: boolean;
  }>('/api/pdf-filler/templates/publish', {
    method: 'POST',
    body: JSON.stringify(params),
  });

export const saveGlobalPdfTemplateSchema = (params: {
  pdfHash: string;
  schema: Record<string, unknown>;
  extractionMethod?: string;
  schemaVersion?: number;
  baselineSchema?: Record<string, unknown>;
  baselineExtractionMethod?: string;
}) =>
  request<{ success: boolean; pdfHash: string; extractionMethod: string; schemaVersion: number }>(
    '/api/pdf-filler/schema/global',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );

/** Returns filled PDF bytes; caller uploads to Google Drive. */
export async function fillPdfFormStream(params: {
  fileName: string;
  fileData: string;
  schema: Record<string, unknown>;
  answers: Record<string, unknown>;
}): Promise<Blob> {
  const url = `${API_BASE}/api/pdf-filler/fill`;
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    let message = 'PDF fill failed.';
    try {
      const err = (await res.json()) as { error?: string; detail?: string };
      message = err.detail || err.error || message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status);
  }
  return res.blob();
}
