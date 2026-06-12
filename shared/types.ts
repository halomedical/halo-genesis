// Shared types used by both client and server

export interface Patient {
  id: string;
  name: string;
  dob: string;
  sex: 'M' | 'F';
  lastVisit: string;
  alerts: string[];
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

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  url: string;
  thumbnail?: string;
  createdTime: string;
}

export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface BreadcrumbItem {
  id: string;
  name: string;
}

export interface LabAlert {
  parameter: string;
  value: string;
  severity: "high" | "medium" | "low";
  context: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatAttachment {
  name: string;
  mimeType: string;
  base64Data: string;
}

export enum AppStatus {
  IDLE = 'idle',
  LOADING = 'loading',
  UPLOADING = 'uploading',
  ANALYZING = 'analyzing',
  SAVING = 'saving',
  FILING = 'filing'
}

export interface UserSettings {
  // Profile (mandatory)
  firstName: string;
  lastName: string;
  profession: string;
  department: string;
  // Profile (optional)
  city: string;
  postalCode: string;
  university: string;
  // Template (legacy)
  noteTemplate: 'soap' | 'custom';
  customTemplateContent: string;
  customTemplateName: string;
  // Halo template (for generate_note)
  templateId?: string;
  modules?: UserModulesSettings;
  billing?: UserBillingSettings;
}

export interface UserBillingProviderSettings {
  name?: string;
  practiceNumber?: string;
  hpcNumber?: string;
  bhfNumber?: string;
  groupPracticeNumber?: string;
}

export interface UserBillingSettings {
  schemeCode?: string;
  planCode?: string;
  provider?: UserBillingProviderSettings;
}

export interface UserModulesSettings {
  admissions: boolean;
  adminAgent: boolean;
  scribe: boolean;
  billing: boolean;
  pdfFiller: boolean;
}

export const DEFAULT_USER_MODULES: UserModulesSettings = {
  admissions: false,
  adminAgent: false,
  scribe: true,
  billing: false,
  pdfFiller: false,
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  firstName: '',
  lastName: '',
  profession: '',
  department: '',
  city: '',
  postalCode: '',
  university: '',
  noteTemplate: 'soap',
  customTemplateContent: '',
  customTemplateName: '',
  templateId: 'clinical_note',
  modules: DEFAULT_USER_MODULES,
};

export function normalizeUserSettings(value: Partial<UserSettings> | null | undefined): UserSettings {
  return {
    ...DEFAULT_USER_SETTINGS,
    ...(value || {}),
    modules: {
      ...DEFAULT_USER_MODULES,
      ...(value?.modules || {}),
    },
    billing: {
      ...(value?.billing || {}),
      provider: {
        ...(value?.billing?.provider || {}),
      },
    },
  };
}

export interface NoteField {
  label: string;
  body: string;
}

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface HaloNote {
  noteId: string;
  title: string;
  content: string;
  template_id: string;
  lastSavedAt?: string;
  dirty?: boolean;
  /** Structured fields from generate_note (for preview before DOCX) */
  fields?: NoteField[];
  /** Raw JSON-safe Halo note payload for structured history restore. */
  rawData?: JsonValue;
}

export interface ScribeSessionNote {
  noteId: string;
  title: string;
  content: string;
  template_id: string;
  fields?: NoteField[];
  rawData?: JsonValue;
}

export interface HaloTemplate {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface CalendarAttachment {
  fileId: string;
  name?: string;
  url?: string;
  mimeType?: string;
}

export interface CalendarEvent {
  id: string;
  /** Underlying Google Calendar ID, if different from id */
  calendarId?: string;
  start: string;
  end: string;
  title: string;
  description?: string;
  location?: string;
  /** Matched HALO patient id, if any */
  patientId?: string;
  /** Optional display color hint for UI */
  color?: string;
  /** Attached Drive files or attachment metadata */
  attachments?: CalendarAttachment[];
  /** Additional metadata from Google extendedProperties.private */
  extendedProps?: Record<string, string>;
}

export interface ScribeSession {
  /** Unique session id (per patient). */
  id: string;
  /** Google Drive patient folder id this session belongs to. */
  patientId: string;
  /** ISO timestamp when the session was created. */
  createdAt: string;
  /** Full transcript text used to generate notes. */
  transcript: string;
  /** Optional free-text context captured alongside the transcript. */
  context?: string;
  /** Template IDs that were used to generate notes in this session. */
  templates?: string[];
  /** Human-readable note titles generated in this session (for display only). */
  noteTitles?: string[];
  /** Generated note content for this session (so we can show the actual note, not just transcript). */
  notes?: ScribeSessionNote[];
  /** Short main complaint/summary for list display (e.g. "Ankle Fracture"). */
  mainComplaint?: string;
}

export interface PatientSummaryFormContribution {
  at: string;
  templateId: string;
  templateName: string;
  lines: string[];
}

export interface PatientSummaryTimelineEntry {
  id: string;
  sourceId: string;
  sourceType: 'file' | 'consultation' | 'form';
  title: string;
  dateLabel: string;
  happenedAt: string;
  bullets: string[];
  sourceName?: string;
}

export interface PatientSummaryProcessedSource {
  sourceId: string;
  sourceType: 'file' | 'consultation' | 'form';
  sourceName: string;
  sourceUpdatedAt: string;
  processedAt: string;
}

export interface PatientSummaryState {
  version: number;
  patientId: string;
  patientName: string;
  lastUpdatedAt: string | null;
  dirty: boolean;
  snapshot: string[];
  timeline: PatientSummaryTimelineEntry[];
  processedSources: Record<string, PatientSummaryProcessedSource>;
  formContributions?: PatientSummaryFormContribution[];
}

export interface AdmissionsTask {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
}

export interface AdmissionsCardMovement {
  columnId: string;
  columnTitle: string;
  enteredAt: string;
  exitedAt?: string;
}

export interface AdmissionsCard {
  id: string;
  patientId: string;
  patientName: string;
  folderNumber?: string;
  diagnosis: string;
  coManagingDoctors: string[];
  tags: string[];
  tasks: AdmissionsTask[];
  enteredColumnAt: string;
  createdAt: string;
  updatedAt: string;
  movementHistory: AdmissionsCardMovement[];
}

export interface AdmissionsColumn {
  id: string;
  title: string;
  cards: AdmissionsCard[];
}

export interface AdmissionsBoard {
  version: number;
  updatedAt: string;
  columns: AdmissionsColumn[];
}
