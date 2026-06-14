import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Patient, DriveFile, BreadcrumbItem, ChatAttachment, ChatMessage, HaloNote, NoteField, CalendarEvent, ScribeSession } from '../../../../shared/types';
import { AppStatus, FOLDER_MIME_TYPE } from '../../../../shared/types';

import {
  fetchFiles,
  fetchFilesFirstPage,
  fetchFilesPage,
  fetchFolderContents,
  warmAndListFiles,
  uploadFile,
  updatePatient,
  updateFileMetadata,
  analyzeAndRenameImage,
  deleteFile,
  createFolder,
  askHaloStream,
  askHalo,
  generateNotePreview,
  previewNotePdf,
  saveNoteAsDocx,
  emailNoteAsDocx,
  generatePrepNote,
  getHaloTemplates,
  describeFile,
  fetchPatientSessions,
  fetchPatientSummary,
  savePatientSession,
  updatePatientFamily,
} from '../services/api';
import {
  Upload, Calendar, Clock, ChevronLeft, Loader2,
  CloudUpload, Pencil, X, Trash2, FolderOpen, MessageCircle,
  FolderPlus, ChevronRight, ExternalLink, FileText, Layers, Plus,
  History, CreditCard,
} from 'lucide-react';
import { HeaderConsultationRecorder } from '../modules/scribe/features/scribe/HeaderConsultationRecorder';
import { FileViewer } from '../components/FileViewer';
import { FileBrowser } from '../components/FileBrowser';
import { NoteEditor } from '../components/NoteEditor';
import { PatientChat } from '../components/PatientChat';
import { PatientFormIntelligenceTab } from '../modules/pdf-filler/components/PatientFormIntelligenceTab';
import type { UploadHudState } from '../components/UploadHud';
import { getErrorMessage } from '../utils/formatting';

const MAX_MAIN_COMPLAINT_LEN = 80;

export interface WorkspaceNavigationIntent {
  id: string;
  tab: 'overview' | 'notes' | 'chat' | 'sessions';
  freshSession?: boolean;
}

/** Extract a short main complaint from note content for session list title (e.g. "Ankle Fracture"). */
function extractMainComplaint(content: string): string {
  if (!content || typeof content !== 'string') return '';
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const complaintHeaders = /^(?:presenting complaint|chief complaint|reason for visit|main complaint|now):\s*/i;
  for (const line of lines) {
    const match = line.match(complaintHeaders);
    if (match) {
      const after = line.slice(match[0].length).trim();
      if (after) return after.slice(0, MAX_MAIN_COMPLAINT_LEN);
    }
    if (line.startsWith('-') && line.length > 1) {
      const text = line.slice(1).trim();
      if (text && text.length < 120) return text.slice(0, MAX_MAIN_COMPLAINT_LEN);
    }
  }
  const first = lines[0];
  if (first && first.length < 120) return first.slice(0, MAX_MAIN_COMPLAINT_LEN);
  return '';
}

function fieldsToNoteContent(fields: NoteField[]): string {
  return fields
    .map((f) => (f.label ? `${f.label}:\n${f.body ?? ''}` : f.body))
    .filter(Boolean)
    .join('\n\n');
}

/** Effective note text for save/email: content or decoded from fields. */
function getNoteText(note: HaloNote): string {
  if (note.fields?.length) {
    return fieldsToNoteContent(note.fields as NoteField[]);
  }
  if (note.content?.trim()) return note.content;
  return '';
}

function serializeSessionNotes(notes: HaloNote[]) {
  return notes.map((note) => ({
    noteId: note.noteId,
    title: note.title,
    content: getNoteText(note),
    template_id: note.template_id,
    ...(note.fields && note.fields.length > 0 ? { fields: note.fields } : {}),
    ...(note.rawData !== undefined ? { rawData: note.rawData } : {}),
  }));
}

function buildNotePreviewSignature(note: HaloNote): string {
  return JSON.stringify({
    title: note.title,
    templateId: note.template_id,
    text: getNoteText(note),
  });
}

/** Fallback when Halo get_templates fails or returns empty; use real IDs from Halo when possible to avoid 404. */
const DEFAULT_TEMPLATE_OPTIONS: Array<{ id: string; name: string }> = [
  { id: 'clinical_note', name: 'Clinical Note' },
  { id: 'op_report', name: 'Operation Report' },
  { id: 'jon_note', name: 'Open Note' },
];

/** Orthopaedic surgery Halo user/template mapping (for op_report). */
const ORTHO_TEMPLATE_ID = 'op_report';
const ORTHO_USER_ID = '224e8ca0-b8ef-4c6e-8707-e9e0a7774ec5';

function getHaloUserForTemplate(templateId: string | undefined): string | undefined {
  if (!templateId) return undefined;
  if (templateId === ORTHO_TEMPLATE_ID) return ORTHO_USER_ID;
  return undefined;
}

function normalizeHaloTemplates(raw: Record<string, unknown>): Array<{ id: string; name: string }> {
  if (!raw || typeof raw !== 'object') return [];
  const arr = Array.isArray(raw)
    ? raw
    : raw.templates && Array.isArray(raw.templates)
      ? raw.templates
      : raw;
  // Array: [ { id, name } or { template_id, name } ]
  if (Array.isArray(arr)) {
    return (arr as Array<Record<string, unknown>>)
      .map((t) => {
        const id = (t.id ?? t.template_id ?? t.templateId) as string;
        const name = (t.name ?? t.title ?? id ?? '') as string;
        return id && name ? { id: String(id), name: String(name) } : null;
      })
      .filter((t): t is { id: string; name: string } => t != null);
  }
  // Object: { "templateId": { name: "..." } } (e.g. Firebase users/{id}/templates)
  return Object.entries(arr as Record<string, unknown>).map(([id, val]) => {
    const o = val && typeof val === 'object' ? (val as Record<string, unknown>) : {};
    const name = (o.name ?? o.title ?? id) as string;
    return { id, name: String(name || id) };
  });
}

function parsePatientSummaryMarkdown(markdown: string): {
  lastUpdated: string | null;
  snapshot: string[];
  timeline: Array<{ heading: string; bullets: string[] }>;
} {
  const lines = markdown.split(/\r?\n/);
  let currentSection: 'snapshot' | 'timeline' | null = null;
  let currentTimeline: { heading: string; bullets: string[] } | null = null;
  const snapshot: string[] = [];
  const timeline: Array<{ heading: string; bullets: string[] }> = [];
  let lastUpdated: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('Last updated:')) {
      lastUpdated = line.replace('Last updated:', '').trim();
      continue;
    }
    if (line === '## Current Snapshot') {
      currentSection = 'snapshot';
      currentTimeline = null;
      continue;
    }
    if (line === '## Timeline') {
      currentSection = 'timeline';
      currentTimeline = null;
      continue;
    }
    if (line.startsWith('### ')) {
      currentTimeline = { heading: line.replace(/^###\s+/, ''), bullets: [] };
      timeline.push(currentTimeline);
      continue;
    }
    if (line.startsWith('- ')) {
      const bullet = line.slice(2).trim();
      if (!bullet) continue;
      if (currentSection === 'snapshot') {
        snapshot.push(bullet);
      } else if (currentSection === 'timeline' && currentTimeline) {
        currentTimeline.bullets.push(bullet);
      }
    }
  }

  return { lastUpdated, snapshot, timeline };
}

function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1].toLowerCase() : '';
}

interface Props {
  patient: Patient;
  allPatients: Patient[];
  onBack: () => void;
  onOpenPatient?: (patientId: string) => void;
  onDataChange: () => void;
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
  templateId?: string;
  scribeEnabled?: boolean;
  pdfFillerEnabled?: boolean;
  onUploadHudChange?: (state: UploadHudState | null) => void;
  calendarPrepEvent?: CalendarEvent | null;
  navigationIntent?: WorkspaceNavigationIntent | null;
  onNavigationIntentHandled?: (intentId: string) => void;
}

export const PatientWorkspace: React.FC<Props> = ({
  patient,
  allPatients,
  onBack,
  onOpenPatient,
  onDataChange,
  onToast,
  templateId: propTemplateId,
  scribeEnabled = true,
  pdfFillerEnabled = false,
  onUploadHudChange,
  calendarPrepEvent,
  navigationIntent,
  onNavigationIntentHandled,
}) => {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [notes, setNotes] = useState<HaloNote[]>([]);
  const [templateId, setTemplateId] = useState(propTemplateId || 'clinical_note');
  const [pendingTranscript, setPendingTranscript] = useState<string | null>(null);
  /** Full transcript for the current session (all completed segments). */
  const [lastTranscript, setLastTranscript] = useState<string>('');
  /** Live transcript for the current in-progress recording segment (not yet merged into lastTranscript). */
  const [liveTranscriptSegment, setLiveTranscriptSegment] = useState<string>('');
  const [isLiveStreaming, setIsLiveStreaming] = useState(false);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [consultSubTab, setConsultSubTab] = useState<'transcript' | 'context' | number>('transcript');
  const [templateOptions, setTemplateOptions] = useState<Array<{ id: string; name: string }>>(DEFAULT_TEMPLATE_OPTIONS);
  const [selectedTemplatesForGenerate, setSelectedTemplatesForGenerate] = useState<string[]>(['clinical_note']);
  const [templateSearch, setTemplateSearch] = useState('');
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'notes' | 'chat' | 'sessions' | 'form-intelligence'
  >('overview');
  const [savingNoteIndex, setSavingNoteIndex] = useState<number | null>(null);
  const [isGeneratingNotes, setIsGeneratingNotes] = useState(false);
  const [showCustomAiNoteModal, setShowCustomAiNoteModal] = useState(false);
  const [customAiPrompt, setCustomAiPrompt] = useState('');
  const [customAiLoading, setCustomAiLoading] = useState(false);
  const [consultContext, setConsultContext] = useState('');
  const [didCopyTranscript, setDidCopyTranscript] = useState(false);
  const [noteGenerationStep, setNoteGenerationStep] = useState(0);
  const [sessions, setSessions] = useState<ScribeSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [patientSummaryMarkdown, setPatientSummaryMarkdown] = useState('');
  const [patientSummaryLoading, setPatientSummaryLoading] = useState(false);

  // Derived "current" transcript that the UI shows and copies:
  // any completed segments (lastTranscript) plus the current live segment (if recording).
  const currentTranscript = liveTranscriptSegment
    ? (lastTranscript ? `${lastTranscript}\n\n${liveTranscriptSegment}` : liveTranscriptSegment)
    : lastTranscript;

  // Folder navigation state
  const [currentFolderId, setCurrentFolderId] = useState<string>(patient.id);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { id: patient.id, name: patient.name },
  ]);

  const [editingPatient, setEditingPatient] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDob, setEditDob] = useState("");
  const [editSex, setEditSex] = useState<'M' | 'F'>('M');
  const [editingBilling, setEditingBilling] = useState(false);
  const [editMedicalAid, setEditMedicalAid] = useState("");
  const [editMedicalAidPlan, setEditMedicalAidPlan] = useState("");
  const [editMedicalAidNumber, setEditMedicalAidNumber] = useState("");
  const [editSchemeCode, setEditSchemeCode] = useState("");
  const [editPlanCode, setEditPlanCode] = useState("");
  const [editMemberNumber, setEditMemberNumber] = useState("");
  const [editDependantCode, setEditDependantCode] = useState("");
  const [editInitials, setEditInitials] = useState("");
  const [editStatusIndicator, setEditStatusIndicator] = useState("");
  const [editFamilyName, setEditFamilyName] = useState("");
  const [editFamilyMemberIds, setEditFamilyMemberIds] = useState<string[]>([]);

  const [editingFile, setEditingFile] = useState<DriveFile | null>(null);
  const [editFileName, setEditFileName] = useState("");

  const [fileToDelete, setFileToDelete] = useState<DriveFile | null>(null);

  // File viewer state
  const [viewingFile, setViewingFile] = useState<DriveFile | null>(null);

  // Chat state — use a ref to always have the latest messages for API calls
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatLongWait, setChatLongWait] = useState(false);
  const chatMessagesRef = useRef<ChatMessage[]>([]);
  const chatLongWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  chatMessagesRef.current = chatMessages;

  // Create folder state
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Upload destination picker state
  const [showUploadPicker, setShowUploadPicker] = useState(false);
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string>(patient.id);
  const [uploadTargetLabel, setUploadTargetLabel] = useState<string>(patient.name);
  const [uploadPickerFolders, setUploadPickerFolders] = useState<DriveFile[]>([]);
  const [uploadPickerLoading, setUploadPickerLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showContextDrivePicker, setShowContextDrivePicker] = useState(false);
  const [contextDriveFiles, setContextDriveFiles] = useState<DriveFile[]>([]);
  const [contextDriveLoading, setContextDriveLoading] = useState(false);
  const [contextDriveSelectedIds, setContextDriveSelectedIds] = useState<string[]>([]);
  const previewUrlStoreRef = useRef<Record<string, string>>({});
  const [notePreviewUrls, setNotePreviewUrls] = useState<Record<string, string>>({});
  const [notePreviewErrors, setNotePreviewErrors] = useState<Record<string, string>>({});
  const [notePreviewSignatures, setNotePreviewSignatures] = useState<Record<string, string>>({});
  const [noteViewModes, setNoteViewModes] = useState<Record<string, 'edit' | 'preview'>>({});
  const [previewLoadingNoteId, setPreviewLoadingNoteId] = useState<string | null>(null);

  const allOtherPatients = allPatients.filter((candidate) => candidate.id !== patient.id);
  const currentFamilyMembers = patient.familyGroupId
    ? allOtherPatients.filter((candidate) => candidate.familyGroupId === patient.familyGroupId)
    : [];
  const currentFamilyMemberIds = currentFamilyMembers.map((candidate) => candidate.id);
  const patientSurname = extractSurname(patient.name);
  const suggestedSurnameMembers = allOtherPatients.filter((candidate) => {
    if (!patientSurname) return false;
    if (currentFamilyMemberIds.includes(candidate.id)) return false;
    return extractSurname(candidate.name) === patientSurname;
  });
  const patientPlanHint = (patient.memberNumber || patient.medicalAidNumber || '').trim();
  const suggestedPlanMembers = allOtherPatients.filter((candidate) => {
    if (!patientPlanHint) return false;
    if (currentFamilyMemberIds.includes(candidate.id)) return false;
    if (suggestedSurnameMembers.some((item) => item.id === candidate.id)) return false;
    return (
      (candidate.memberNumber || '').trim() === patientPlanHint ||
      (candidate.medicalAidNumber || '').trim() === patientPlanHint
    );
  });

  useEffect(() => {
    return () => {
      Object.values(previewUrlStoreRef.current).forEach((url) => URL.revokeObjectURL(url));
      previewUrlStoreRef.current = {};
    };
  }, []);

  useEffect(() => {
    const activeIds = new Set(notes.map((note) => note.noteId));

    setNotePreviewUrls((prev) => {
      const next: Record<string, string> = {};
      for (const [noteId, url] of Object.entries(prev)) {
        if (activeIds.has(noteId)) {
          next[noteId] = url;
        } else {
          URL.revokeObjectURL(url);
        }
      }
      previewUrlStoreRef.current = next;
      return next;
    });

    setNotePreviewErrors((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([noteId]) => activeIds.has(noteId))
      )
    );
    setNotePreviewSignatures((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([noteId]) => activeIds.has(noteId))
      )
    );
    setNoteViewModes((prev) =>
      Object.fromEntries(
        Object.entries(prev).filter(([noteId]) => activeIds.has(noteId))
      ) as Record<string, 'edit' | 'preview'>
    );

    if (previewLoadingNoteId && !activeIds.has(previewLoadingNoteId)) {
      setPreviewLoadingNoteId(null);
    }
  }, [notes, previewLoadingNoteId]);

  const isFolder = (file: DriveFile): boolean => file.mimeType === FOLDER_MIME_TYPE;

  // Load folder contents (with loading indicator)
  const loadFolderContents = useCallback(async (folderId: string) => {
    setStatus(AppStatus.LOADING);
    try {
      const contents = folderId === patient.id
        ? await fetchFiles(patient.id)
        : await fetchFolderContents(folderId);
      setFiles(contents);
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
    setStatus(AppStatus.IDLE);
  }, [patient.id, onToast]);

  // Silent refresh (no loading indicator — used for periodic polling)
  const silentRefresh = useCallback(async () => {
    try {
      const contents = currentFolderId === patient.id
        ? await fetchFiles(patient.id)
        : await fetchFolderContents(currentFolderId);
      setFiles(contents);
    } catch {
      // Silent — don't show errors for background refreshes
    }
  }, [currentFolderId, patient.id]);

  // Poll for external changes every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      silentRefresh();
      onDataChange();
    }, 30_000);
    return () => clearInterval(interval);
  }, [silentRefresh, onDataChange]);

  // Clean up upload progress interval on unmount
  useEffect(() => {
    return () => {
      if (uploadIntervalRef.current) clearInterval(uploadIntervalRef.current);
    };
  }, []);

  // Initial load for the current patient folder
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      setStatus(AppStatus.LOADING);
      setFiles([]);
      setChatMessages([]);
      setChatInput("");
      setCurrentFolderId(patient.id);
      setBreadcrumbs([{ id: patient.id, name: patient.name }]);
      setUploadTargetFolderId(patient.id);
      setUploadTargetLabel(patient.name);

      try {
        // Try direct list first (fast when Drive responds). Fall back to warm-and-list if it fails
        // (warm upload can help with Drive API cold start; server has timeouts so we never hang)
        let firstFiles: DriveFile[];
        let nextPage: string | null;
        try {
          const direct = await fetchFilesFirstPage(patient.id, 100);
          firstFiles = direct.files;
          nextPage = direct.nextPage;
        } catch {
          const warm = await warmAndListFiles(patient.id, 100);
          firstFiles = warm.files;
          nextPage = warm.nextPage;
        }
        if (!isMounted) return;
        setFiles(firstFiles);
        setStatus(AppStatus.IDLE);

        // Fetch remaining pages in background and append (so full list appears without blocking UI)
        if (nextPage) {
          (async () => {
            const all = [...firstFiles];
            let page: string | null = nextPage;
            while (page && isMounted) {
              try {
                const data = await fetchFilesPage(patient.id, page);
                all.push(...data.files);
                if (isMounted) setFiles([...all]);
                page = data.nextPage;
              } catch {
                break;
              }
            }
          })();
        }
      } catch (err) {
        if (isMounted) {
          onToast(getErrorMessage(err), 'error');
        }
        if (isMounted) setStatus(AppStatus.IDLE);
      }
    };

    loadData();
    return () => { isMounted = false; };
  }, [patient.id, patient.name, onToast]);

  // Load template list from Halo when user opens Editor & Scribe (use real template IDs to avoid 404)
  // Also load sessions when opening Editor & Scribe or Previous Sessions tab
  useEffect(() => {
    if (activeTab !== 'notes' && activeTab !== 'sessions') return;

    if (activeTab === 'notes') {
      getHaloTemplates()
        .then((raw) => {
          const list = normalizeHaloTemplates(raw as Record<string, unknown>);
          if (list.length > 0) {
            setTemplateOptions(list);
            setSelectedTemplatesForGenerate((prev) => {
              const valid = prev.filter((id) => list.some((t) => t.id === id));
              return valid.length > 0 ? valid : [list[0].id];
            });
          }
        })
        .catch(() => {
          // Keep DEFAULT_TEMPLATE_OPTIONS on failure
        });
    }

    setSessionsLoading(true);
    fetchPatientSessions(patient.id)
      .then((res) => {
        const items = Array.isArray(res.sessions) ? res.sessions : [];
        const sorted = [...items].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
        setSessions(sorted);
      })
      .catch(() => {
        setSessions([]);
        setActiveSessionId(null);
      })
      .finally(() => {
        setSessionsLoading(false);
      });

    if (activeTab === 'sessions') {
      setPatientSummaryLoading(true);
      fetchPatientSummary(patient.id)
        .then((res) => {
          setPatientSummaryMarkdown(res.markdown || '');
        })
        .catch(() => {
          setPatientSummaryMarkdown('');
        })
        .finally(() => {
          setPatientSummaryLoading(false);
        });
    }
  }, [activeTab, patient.id]);

  // Navigate into a subfolder
  const navigateToFolder = async (folder: DriveFile) => {
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
    setCurrentFolderId(folder.id);
    await loadFolderContents(folder.id);
  };

  const navigateBack = async () => {
    if (breadcrumbs.length <= 1) return;
    const newBreadcrumbs = breadcrumbs.slice(0, -1);
    const parentId = newBreadcrumbs[newBreadcrumbs.length - 1].id;
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFolderId(parentId);
    await loadFolderContents(parentId);
  };

  const navigateToBreadcrumb = async (index: number) => {
    if (index === breadcrumbs.length - 1) return;
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    const targetId = newBreadcrumbs[newBreadcrumbs.length - 1].id;
    setBreadcrumbs(newBreadcrumbs);
    setCurrentFolderId(targetId);
    await loadFolderContents(targetId);
  };

  const handleContextUploadClick = () => {
    setUploadTargetFolderId(patient.id);
    setUploadTargetLabel(patient.name);
    fileInputRef.current?.click();
  };

  // Upload destination picker — always default to current patient so switching profiles doesn't show previous patient
  const openUploadPicker = async () => {
    setUploadTargetFolderId(patient.id);
    setUploadTargetLabel(patient.name);
    setShowUploadPicker(true);
    setUploadPickerLoading(true);
    try {
      const contents = await fetchFiles(patient.id);
      setUploadPickerFolders(contents.filter(f => f.mimeType === FOLDER_MIME_TYPE));
    } catch {
      setUploadPickerFolders([]);
    }
    setUploadPickerLoading(false);
  };

  const selectUploadFolder = async (folder: DriveFile) => {
    setUploadTargetFolderId(folder.id);
    setUploadTargetLabel(folder.name);
    setUploadPickerLoading(true);
    try {
      const contents = await fetchFolderContents(folder.id);
      setUploadPickerFolders(contents.filter(f => f.mimeType === FOLDER_MIME_TYPE));
    } catch {
      setUploadPickerFolders([]);
    }
    setUploadPickerLoading(false);
  };

  const confirmUploadDestination = () => {
    setShowUploadPicker(false);
    fileInputRef.current?.click();
  };

  const openContextDrivePicker = async () => {
    setShowContextDrivePicker(true);
    setContextDriveLoading(true);
    setContextDriveSelectedIds([]);
    try {
      const rootFiles = await fetchFiles(patient.id);
      setContextDriveFiles(rootFiles);
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
      setContextDriveFiles([]);
    }
    setContextDriveLoading(false);
  };

  const toggleContextDriveSelection = (fileId: string) => {
    setContextDriveSelectedIds(prev =>
      prev.includes(fileId) ? prev.filter(id => id !== fileId) : [...prev, fileId]
    );
  };

  const applyContextDriveSelection = () => {
    const selectedFiles = contextDriveFiles.filter(
      (file) => contextDriveSelectedIds.includes(file.id) && !isFolder(file)
    );
    if (selectedFiles.length === 0) {
      setShowContextDrivePicker(false);
      return;
    }
    const fileList = selectedFiles.map((f) => `- ${f.name}`).join('\n');
    const prefix = 'Files to review:\n';
    setConsultContext((prev) =>
      prev ? `${prev}\n\n${prefix}${fileList}` : `${prefix}${fileList}`
    );
    setShowContextDrivePicker(false);
  };

  const updateUploadHud = useCallback((state: UploadHudState | null) => {
    onUploadHudChange?.(state);
  }, [onUploadHudChange]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const targetId = uploadTargetFolderId;
    let progress = 10;

    updateUploadHud({
      phase: 'uploading',
      title: file.name,
      detail: `Uploading to ${uploadTargetLabel}`,
      progress,
    });

    // Track interval in a ref so it's cleaned up on unmount
    if (uploadIntervalRef.current) clearInterval(uploadIntervalRef.current);
    uploadIntervalRef.current = setInterval(() => {
      progress = progress >= 90 ? 90 : progress + 10;
      updateUploadHud({
        phase: 'uploading',
        title: file.name,
        detail: `Uploading to ${uploadTargetLabel}`,
        progress,
      });
    }, 200);

    await new Promise(r => setTimeout(r, 1600));
    if (uploadIntervalRef.current) {
      clearInterval(uploadIntervalRef.current);
      uploadIntervalRef.current = null;
    }

    const performUpload = async (base64?: string) => {
      let finalName = file.name;
      try {
        if (base64 && file.type.startsWith('image/')) {
          updateUploadHud({
            phase: 'processing',
            title: file.name,
            detail: 'Analyzing image and preparing the upload',
            progress: Math.max(progress, 92),
          });
          finalName = await analyzeAndRenameImage(base64);
        }
      } catch {
        // AI rename not available
      }

      try {
        const uploaded = await uploadFile(targetId, file, finalName, patient.id);
        updateUploadHud({
          phase: 'success',
          title: finalName,
          detail: `Saved to ${uploadTargetLabel}`,
          progress: 100,
        });
        await silentRefresh();
        onToast(`File uploaded to "${uploadTargetLabel}".`, 'success');

        // Best-effort: ask Gemini to describe the uploaded file for future context
        try {
          const description = await describeFile(patient.id, uploaded);
          if (description && description.trim()) {
            setConsultContext(prev =>
              prev
                ? `${prev}\n\n${uploaded.name} — AI description:\n${description}`
                : `${uploaded.name} — AI description:\n${description}`
            );
          }
        } catch {
          // Description is optional; ignore failures
        }
      } catch (err) {
        updateUploadHud(null);
        onToast(getErrorMessage(err), 'error');
      }
      setStatus(AppStatus.IDLE);
    };

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        performUpload(base64);
      };
      reader.readAsDataURL(file);
    } else {
      performUpload();
    }

    e.target.value = '';
  };

  useEffect(() => {
    if (propTemplateId) setTemplateId(propTemplateId);
  }, [propTemplateId]);

  const handleNoteChange = useCallback((noteIndex: number, updates: { title?: string; content?: string; fields?: NoteField[] }) => {
    setNotes(prev => prev.map((n, i) => {
      if (i !== noteIndex) return n;

      const nextFields = updates.fields !== undefined ? updates.fields : n.fields;
      const nextContent = updates.fields !== undefined
        ? fieldsToNoteContent(updates.fields)
        : updates.content !== undefined
          ? updates.content
          : n.content;

      return {
        ...n,
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.fields !== undefined && { fields: nextFields }),
        content: nextContent,
        dirty: true,
      };
    }));
  }, []);

  const buildNoteFileName = useCallback(
    (tplId: string | undefined, fallbackTitle: string) => {
      const today = new Date();
      const dateStr = today.toISOString().slice(0, 10);
      const templateName =
        templateOptions.find(t => t.id === tplId)?.name ||
        tplId ||
        fallbackTitle ||
        'Note';
      const raw = `${patient.name} - ${dateStr} - ${templateName}`;
      return raw.replace(/[^\w\s-]/g, '').trim() || undefined;
    },
    [patient.name, templateOptions]
  );

  const loadNotePreview = useCallback(async (noteIndex: number, force = false) => {
    const note = notes[noteIndex];
    if (!note) return;

    const signature = buildNotePreviewSignature(note);
    const cachedSignature = notePreviewSignatures[note.noteId];
    const cachedUrl = notePreviewUrls[note.noteId];
    if (!force && cachedUrl && cachedSignature === signature) {
      return;
    }

    setPreviewLoadingNoteId(note.noteId);
    setNotePreviewErrors((prev) => {
      if (!prev[note.noteId]) return prev;
      const next = { ...prev };
      delete next[note.noteId];
      return next;
    });

    const text = getNoteText(note);
    if (!text.trim()) {
      setPreviewLoadingNoteId((prev) => (prev === note.noteId ? null : prev));
      throw new Error('There is no note content to preview yet.');
    }

    const tplId = note.template_id || templateId;
    const fileName = buildNoteFileName(tplId, note.title || 'Note');
    try {
      const blob = await previewNotePdf({
        patientId: patient.id,
        template_id: tplId,
        text,
        fileName,
        user_id: getHaloUserForTemplate(tplId),
      });
      const nextUrl = URL.createObjectURL(blob);
      const previousUrl = previewUrlStoreRef.current[note.noteId];
      if (previousUrl && previousUrl !== nextUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      const nextUrlMap = {
        ...previewUrlStoreRef.current,
        [note.noteId]: nextUrl,
      };
      previewUrlStoreRef.current = nextUrlMap;
      setNotePreviewUrls(nextUrlMap);
      setNotePreviewSignatures((prev) => ({
        ...prev,
        [note.noteId]: signature,
      }));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to generate the PDF preview.';
      setNotePreviewErrors((prev) => ({
        ...prev,
        [note.noteId]: message,
      }));
      throw err;
    } finally {
      setPreviewLoadingNoteId((prev) => (prev === note.noteId ? null : prev));
    }
  }, [notes, notePreviewSignatures, notePreviewUrls, patient.id, templateId, buildNoteFileName]);

  const handleSaveAsDocx = useCallback(async (noteIndex: number) => {
    const note = notes[noteIndex];
    const text = note ? getNoteText(note) : '';
    if (!text.trim()) return;
    setSavingNoteIndex(noteIndex);
    setStatus(AppStatus.SAVING);
    try {
      const tplId = note.template_id || templateId;
      const fileName = buildNoteFileName(tplId, note.title || 'Note');
      await saveNoteAsDocx({
        patientId: patient.id,
        template_id: tplId,
        text,
        fileName,
        user_id: getHaloUserForTemplate(tplId),
      });
      setNotes(prev => prev.map((n, i) => i !== noteIndex ? n : { ...n, lastSavedAt: new Date().toISOString(), dirty: false }));
      await loadFolderContents(currentFolderId);
      onDataChange();
      onToast('Note saved as DOCX to Patient Notes folder.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
    setSavingNoteIndex(null);
    setStatus(AppStatus.IDLE);
  }, [notes, patient.id, templateId, currentFolderId, loadFolderContents, onDataChange, onToast, buildNoteFileName]);

  const handleSaveAll = useCallback(async () => {
    setStatus(AppStatus.SAVING);
    let saved = 0;
    try {
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        const text = getNoteText(note);
        if (!text.trim()) continue;
        const tplId = note.template_id || templateId;
        const fileName = buildNoteFileName(tplId, note.title || `Note ${i + 1}`);
        await saveNoteAsDocx({
          patientId: patient.id,
          template_id: tplId,
          text,
          fileName,
          user_id: getHaloUserForTemplate(tplId),
        });
        setNotes(prev => prev.map((n, j) => j !== i ? n : { ...n, lastSavedAt: new Date().toISOString(), dirty: false }));
        saved++;
      }
      if (saved > 0) {
        await loadFolderContents(currentFolderId);
        onDataChange();
        onToast(`Saved ${saved} note(s) as DOCX.`, 'success');
      }
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
    setStatus(AppStatus.IDLE);
  }, [notes, patient.id, templateId, currentFolderId, loadFolderContents, onDataChange, onToast, buildNoteFileName]);

  const handleEmail = useCallback(async (noteIndex: number) => {
    const note = notes[noteIndex];
    const text = note ? getNoteText(note) : '';
    if (!text.trim()) return;
    setSavingNoteIndex(noteIndex);
    setStatus(AppStatus.SAVING);
    try {
      const tplId = note.template_id || templateId;
      const fileName = buildNoteFileName(tplId, note.title || 'Note');
      const result = await emailNoteAsDocx({
        patientId: patient.id,
        patientName: patient.name,
        text,
        fileName,
      });
      setNotes(prev => prev.map((n, i) => i !== noteIndex ? n : { ...n, lastSavedAt: new Date().toISOString(), dirty: false }));
      await loadFolderContents(currentFolderId);
      onDataChange();
      if (result.emailSent) {
        onToast('Note saved to Drive and emailed to your account.', 'success');
      } else {
        onToast('Note saved to Drive. Email delivery requires SMTP configuration.', 'info');
      }
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
    setSavingNoteIndex(null);
    setStatus(AppStatus.IDLE);
  }, [notes, patient.id, patient.name, templateId, currentFolderId, loadFolderContents, onDataChange, onToast, buildNoteFileName]);

  const GENERATE_TIMEOUT_MS = 95_000;

  const generateNotesFromTranscript = useCallback(
    async (transcriptToUse: string, isAddNote: boolean) => {
      const trimmedTranscript = transcriptToUse.trim();
      if (selectedTemplatesForGenerate.length === 0) {
        onToast('Select at least one template.', 'info');
        return;
      }
      if (!trimmedTranscript) {
        onToast('No transcript to generate from. Use the Scribe to dictate first.', 'info');
        return;
      }
      setPendingTranscript(null);
      setShowAddNoteModal(false);
      setIsGeneratingNotes(true);
      setNoteGenerationStep(0);
      const templateIds = selectedTemplatesForGenerate;
      const templateNames = Object.fromEntries(templateOptions.map(t => [t.id, t.name]));

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Note generation is taking too long. Please try again.')), GENERATE_TIMEOUT_MS)
      );
      try {
        const results = await Promise.race([
          Promise.all(
            templateIds.map(id =>
              generateNotePreview({
                template_id: id,
                text: trimmedTranscript,
                user_id: getHaloUserForTemplate(id),
              })
            )
          ),
          timeoutPromise,
        ]);
        const combined: HaloNote[] = results.map((res, i) => {
          const tid = templateIds[i];
          const name = templateNames[tid] ?? tid;
          const first = res.notes?.[0];
          const fromFields =
            first?.fields && first.fields.length > 0
              ? fieldsToNoteContent(first.fields)
              : '';
          const content =
            first?.content?.trim() || fromFields || trimmedTranscript;
          return {
            noteId: first?.noteId ?? `note-${tid}-${Date.now()}`,
            title: first?.title ?? name,
            content,
            template_id: tid,
            lastSavedAt: new Date().toISOString(),
            dirty: false,
            ...(first?.fields && first.fields.length > 0 ? { fields: first.fields } : {}),
            ...(first?.rawData !== undefined ? { rawData: first.rawData } : {}),
          };
        });
        if (isAddNote) {
          setNotes(prev => [...prev, ...combined]);
          setConsultSubTab(notes.length);
        } else {
          setLastTranscript(trimmedTranscript);
          setNotes(combined);
          setConsultSubTab(0);
        }

        // Persist this consultation as a scribe session for this patient (including generated note content)
        try {
          const firstNoteContent = combined[0]?.content ?? '';
          const mainComplaint = extractMainComplaint(firstNoteContent);
          const payload = {
            sessionId: activeSessionId || undefined,
            transcript: trimmedTranscript,
            context: consultContext || undefined,
            templates: templateIds,
            noteTitles: combined.map((n) => n.title).filter(Boolean),
            notes: serializeSessionNotes(combined),
            ...(mainComplaint ? { mainComplaint } : {}),
          };
          const res = await savePatientSession(patient.id, payload);
          const items = Array.isArray(res.sessions) ? res.sessions : [];
          const sorted = [...items].sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
          setSessions(sorted);
          setActiveSessionId(sorted[0]?.id ?? null);
        } catch {
          // Session history is best-effort; ignore failures
        }

        onToast(`Generated ${combined.length} note(s). You can edit and save as DOCX.`, 'success');
      } catch (err) {
        onToast(getErrorMessage(err), 'error');
      }
      setIsGeneratingNotes(false);
      setNoteGenerationStep(0);
    },
    [
      GENERATE_TIMEOUT_MS,
      activeSessionId,
      consultContext,
      onToast,
      patient.id,
      selectedTemplatesForGenerate,
      templateOptions,
    ]
  );

  const prepareFreshRecordingSession = useCallback(() => {
    setActiveSessionId(null);
    setLastTranscript('');
    setLiveTranscriptSegment('');
    setPendingTranscript(null);
    setShowAddNoteModal(false);
    setConsultContext('');
    setNotes([]);
    setConsultSubTab('transcript');
    setDidCopyTranscript(false);
    setActiveTab(scribeEnabled ? 'notes' : 'overview');
  }, [scribeEnabled]);

  useEffect(() => {
    if (!scribeEnabled && (activeTab === 'notes' || activeTab === 'sessions')) {
      setActiveTab('overview');
    }
  }, [activeTab, scribeEnabled]);

  useEffect(() => {
    if (!pdfFillerEnabled && activeTab === 'form-intelligence') {
      setActiveTab('overview');
    }
  }, [activeTab, pdfFillerEnabled]);

  useEffect(() => {
    if (!navigationIntent?.id) return;

    const blockedScribeTab = !scribeEnabled && (navigationIntent.tab === 'notes' || navigationIntent.tab === 'sessions');
    if (blockedScribeTab) {
      setActiveTab('overview');
      onNavigationIntentHandled?.(navigationIntent.id);
      return;
    }

    if (navigationIntent.freshSession) {
      prepareFreshRecordingSession();
    } else {
      setActiveTab(navigationIntent.tab);
    }

    onNavigationIntentHandled?.(navigationIntent.id);
  }, [navigationIntent, onNavigationIntentHandled, prepareFreshRecordingSession, scribeEnabled]);

  const handleLiveTranscriptUpdate = useCallback((segment: string) => {
    // While recording, keep the live segment separate so we can append it
    // to any existing transcript once the doctor stops the recording.
    setIsLiveStreaming(true);
    setLiveTranscriptSegment(segment);
  }, []);

  const handleLiveStopped = useCallback(
    (transcript: string) => {
      setIsLiveStreaming(false);
      setLiveTranscriptSegment('');

      const clean = transcript.trim();
      if (!clean) {
        return;
      }

      const base = lastTranscript.trim();
      const isResume = notes.length > 0 || !!activeSessionId;

      let combined: string;
      if (isResume && base) {
        const timestamp = new Date().toLocaleString();
        const header = `\n\n[Consultation resumed ${timestamp}]\n\n`;
        combined = `${base}${header}${clean}`;
      } else if (base) {
        combined = `${base}\n\n${clean}`;
      } else {
        combined = clean;
      }

      setLastTranscript(combined);

      if (isResume) {
        setPendingTranscript(null);
        setActiveTab('notes');
        void generateNotesFromTranscript(combined, false);
      } else {
        setPendingTranscript(combined);
        setShowAddNoteModal(false);
        setSelectedTemplatesForGenerate(['clinical_note']);
        setActiveTab('notes');
      }
    },
    [activeSessionId, generateNotesFromTranscript, lastTranscript, notes.length]
  );

  const toggleTemplateForGenerate = useCallback((id: string) => {
    setSelectedTemplatesForGenerate(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  }, []);

  const selectAllTemplatesForGenerate = useCallback(() => {
    setSelectedTemplatesForGenerate(templateOptions.map(t => t.id));
  }, [templateOptions]);
  const NOTE_GENERATION_STEPS = [
    'Looking at context',
    'Decoding transcript',
    'Analyzing transcript',
    'Perfecting your style',
    'Making your notes',
  ] as const;

  const handleGenerateFromTemplates = useCallback(async () => {
    const sourceTranscript = (pendingTranscript ?? lastTranscript) || '';
    const isAddNote = showAddNoteModal;
    await generateNotesFromTranscript(sourceTranscript, isAddNote);
  }, [generateNotesFromTranscript, lastTranscript, pendingTranscript, showAddNoteModal]);

  // Autosave: every 30s mark dirty notes as saved (client-side only; no DOCX generation)
  useEffect(() => {
    if (notes.length === 0) return;
    const interval = setInterval(() => {
      setNotes(prev => {
        const hasDirty = prev.some(n => n.dirty);
        if (!hasDirty) return prev;
        return prev.map(note => note.dirty ? { ...note, lastSavedAt: new Date().toISOString(), dirty: false } : note);
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, [notes.length]);

  // Chat handler — uses streaming for progressive response display
  const handleSendChat = async (attachments: ChatAttachment[] = []) => {
    const question = chatInput.trim();
    if (!question || chatLoading) return;

    const userMessage: ChatMessage = { role: 'user', content: question, timestamp: Date.now() };
    setChatMessages(prev => [...prev, userMessage]);
    setChatInput("");
    setChatLoading(true);
    setChatLongWait(false);

    if (chatLongWaitTimerRef.current) clearTimeout(chatLongWaitTimerRef.current);
    chatLongWaitTimerRef.current = setTimeout(() => setChatLongWait(true), 8000);

    const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '', timestamp: Date.now() };
    setChatMessages(prev => [...prev, assistantPlaceholder]);

    try {
      await askHaloStream(
        patient.id,
        question,
        chatMessagesRef.current,
        attachments,
        (chunk) => {
          setChatMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
            }
            return prev;
          });
        }
      );
    } catch (err) {
      setChatMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === 'assistant' && last.content === '') {
          return [...prev.slice(0, -1), {
            ...last,
            content: 'Sorry, I encountered an error. Please try again.',
          }];
        }
        return prev;
      });
      onToast(getErrorMessage(err), 'error');
    } finally {
      setChatLoading(false);
      setChatLongWait(false);
      if (chatLongWaitTimerRef.current) {
        clearTimeout(chatLongWaitTimerRef.current);
        chatLongWaitTimerRef.current = null;
      }
    }
  };

  // If opened from a calendar booking, generate a light prep note and start in the editor
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!calendarPrepEvent || calendarPrepEvent.patientId !== patient.id) return;
      if (notes.length > 0) return; // don’t overwrite existing work

      setActiveTab('notes');
      setStatus(AppStatus.LOADING);
      try {
        const { prepNote } = await generatePrepNote(patient.id, patient.name);
        if (cancelled) return;
        const title = calendarPrepEvent.title || `Prep for ${patient.name}`;
        const newNote: HaloNote = {
          noteId: `prep-${Date.now()}`,
          title,
          content: prepNote,
          template_id: templateId,
          lastSavedAt: new Date().toISOString(),
          dirty: true,
        };
        setNotes([newNote]);
      } catch (err) {
        if (!cancelled) onToast(getErrorMessage(err), 'error');
      }
      if (!cancelled) setStatus(AppStatus.IDLE);
    };
    run();
    return () => { cancelled = true; };
  }, [calendarPrepEvent?.id, calendarPrepEvent?.patientId, calendarPrepEvent?.title, patient.id, patient.name, templateId, notes.length, onToast]);

  // Create folder handler
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await createFolder(currentFolderId, name);
      setShowCreateFolderModal(false);
      setNewFolderName("");
      await loadFolderContents(currentFolderId);
      onToast(`Folder "${name}" created.`, 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
  };

  const startEditPatient = () => {
    setEditName(patient.name);
    setEditDob(patient.dob);
    setEditSex(patient.sex || 'M');
    setEditingPatient(true);
  };

  const startEditBilling = () => {
    setEditMedicalAid(patient.medicalAid || "");
    setEditMedicalAidPlan(patient.medicalAidPlan || "");
    setEditMedicalAidNumber(patient.medicalAidNumber || "");
    setEditSchemeCode(patient.schemeCode || "");
    setEditPlanCode(patient.planCode || "");
    setEditMemberNumber(patient.memberNumber || "");
    setEditDependantCode(patient.dependantCode || "");
    setEditInitials(patient.initials || "");
    setEditStatusIndicator(patient.statusIndicator || "");
    const existingMemberIds = Array.from(new Set(currentFamilyMembers.map((member) => member.id)));
    setEditFamilyMemberIds(existingMemberIds);
    setEditFamilyName(patient.familyName || (patientSurname ? `${patientSurname.toUpperCase()} Family` : ''));
    setEditingBilling(true);
  };

  const savePatientEdit = async () => {
    if (!editName.trim() || !editDob) return;
    try {
      await updatePatient(patient.id, { name: editName, dob: editDob, sex: editSex });
      setEditingPatient(false);
      onDataChange();
      onToast('Patient details updated.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
  };

  const saveBillingEdit = async () => {
    try {
      await updatePatient(patient.id, {
        medicalAid: editMedicalAid,
        medicalAidPlan: editMedicalAidPlan,
        medicalAidNumber: editMedicalAidNumber,
        schemeCode: editSchemeCode,
        planCode: editPlanCode,
        memberNumber: editMemberNumber,
        dependantCode: editDependantCode,
        initials: editInitials,
        statusIndicator: editStatusIndicator,
      });
      await updatePatientFamily(
        patient.id,
        editFamilyMemberIds,
        editFamilyName.trim() || undefined
      );
      setEditingBilling(false);
      onDataChange();
      onToast('Billing details updated.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
  };

  const toggleFamilyMemberSelection = (memberId: string) => {
    setEditFamilyMemberIds((prev) =>
      prev.includes(memberId) ? prev.filter((id) => id !== memberId) : [...prev, memberId]
    );
  };

  const startEditFile = (file: DriveFile) => {
    setEditingFile(file);
    setEditFileName(file.name);
  };

  const saveFileEdit = async () => {
    if (!editingFile || !editFileName.trim()) return;
    try {
      await updateFileMetadata(patient.id, editingFile.id, editFileName);

      const crumbIndex = breadcrumbs.findIndex(b => b.id === editingFile.id);
      if (crumbIndex >= 0) {
        setBreadcrumbs(prev => prev.map((b, i) => i === crumbIndex ? { ...b, name: editFileName } : b));
      }

      setEditingFile(null);
      await loadFolderContents(currentFolderId);
      onDataChange();
      onToast('Item renamed.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
  };

  const confirmDeleteFile = async () => {
    if (!fileToDelete) return;
    try {
      await deleteFile(fileToDelete.id);
      setFileToDelete(null);
      await loadFolderContents(currentFolderId);
      onToast('File moved to trash.', 'success');
    } catch (err) {
      onToast(getErrorMessage(err), 'error');
    }
  };

  const handleCopyTranscript = useCallback(() => {
    const text = currentTranscript.trim();
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setDidCopyTranscript(true);
          setTimeout(() => setDidCopyTranscript(false), 1500);
        })
        .catch(() => {
          onToast('Unable to copy transcript to clipboard.', 'error');
        });
    } else {
      onToast('Copy is not supported in this browser.', 'error');
    }
  }, [currentTranscript, onToast]);

  const handleLoadSession = useCallback(
    (session: ScribeSession | null) => {
      if (!session) {
        prepareFreshRecordingSession();
        return;
      }

      // Load the exact data that was stored for this session (no automatic regeneration).
      setActiveSessionId(session.id);
      const tx = session.transcript || '';
      setLastTranscript(tx);
      setLiveTranscriptSegment('');
      setPendingTranscript(null);
      setShowAddNoteModal(false);
      setConsultContext(session.context || '');
      setDidCopyTranscript(false);

      if (Array.isArray(session.templates) && session.templates.length > 0) {
        setSelectedTemplatesForGenerate(session.templates);
      } else {
        setSelectedTemplatesForGenerate(['clinical_note']);
      }

      if (session.notes && session.notes.length > 0) {
        const restoredNotes: HaloNote[] = session.notes.map((n) => ({
          noteId: n.noteId,
          title: n.title,
          content: n.content,
          template_id: n.template_id,
          lastSavedAt: new Date().toISOString(),
          dirty: false,
          ...(n.fields && n.fields.length > 0 ? { fields: n.fields } : {}),
          ...(n.rawData !== undefined ? { rawData: n.rawData } : {}),
        }));
        setNotes(restoredNotes);
        setConsultSubTab(0);
      } else {
        setNotes([]);
        setConsultSubTab('transcript');
      }

      setActiveTab('notes');
    },
    [prepareFreshRecordingSession]
  );

  useEffect(() => {
    if (!isGeneratingNotes) {
      setNoteGenerationStep(0);
      return;
    }
    setNoteGenerationStep(0);
    const lastIndex = NOTE_GENERATION_STEPS.length - 1;
    const stepMs = 2800;
    const id = setInterval(() => {
      setNoteGenerationStep(prev => {
        if (prev >= lastIndex) return prev;
        return prev + 1;
      });
    }, stepMs);
    return () => clearInterval(id);
    }, [isGeneratingNotes]);

  const parsedPatientSummary = parsePatientSummaryMarkdown(patientSummaryMarkdown);

  return (
    <div className="flex flex-col h-full min-h-0 bg-white relative w-full">
      {/* Header */}
      <div className="border-b border-slate-200 px-4 md:px-8 py-4 flex flex-col md:flex-row md:justify-between md:items-start bg-white shadow-sm z-10 gap-4">
        <div className="flex items-start gap-3">
          <button onClick={onBack} className="md:hidden mt-1 p-2 -ml-2 text-slate-500 hover:text-sky-600 rounded-full">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="group relative">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-bold text-slate-800 tracking-tight leading-tight">{patient.name}</h1>
              <button onClick={startEditPatient} className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-slate-400 hover:text-sky-600 hover:bg-slate-100 rounded-full">
                <Pencil size={16} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500 mt-2 font-medium">
              <span className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded text-slate-600 whitespace-nowrap"><Calendar className="w-3.5 h-3.5" /> {patient.dob}</span>
              <span className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded text-slate-600 whitespace-nowrap">Sex: {patient.sex || 'Unknown'}</span>
              <span className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded text-slate-600 whitespace-nowrap"><Clock className="w-3.5 h-3.5" /> Last: {patient.lastVisit}</span>
              <a
                href={`https://drive.google.com/drive/folders/${patient.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded text-slate-600 whitespace-nowrap hover:bg-sky-100 hover:text-sky-700 transition-colors"
                title="Open patient folder in Google Drive"
              >
                <FolderOpen className="w-3.5 h-3.5" /> Open in Drive <ExternalLink className="w-3 h-3" />
              </a>
              <button
                type="button"
                onClick={startEditBilling}
                className="flex items-center gap-1.5 bg-slate-100 px-2 py-1 rounded text-slate-600 whitespace-nowrap hover:bg-sky-100 hover:text-sky-700 transition-colors"
                title="Edit medical aid and billing details"
              >
                <CreditCard className="w-3.5 h-3.5" /> Billing details
              </button>
            </div>
            {currentFamilyMembers.length > 0 ? (
              <div className="mt-2 rounded-lg border border-sky-100 bg-sky-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-sky-700">
                  Family folder{patient.familyName ? `: ${patient.familyName}` : ''}
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {[patient, ...currentFamilyMembers].map((member) => (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => onOpenPatient?.(member.id)}
                      disabled={!onOpenPatient || member.id === patient.id}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        member.id === patient.id
                          ? 'border-sky-200 bg-white text-sky-700'
                          : 'border-sky-200 bg-white text-slate-700 hover:border-sky-400 hover:text-sky-700'
                      }`}
                    >
                      {member.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-center md:items-end gap-2 w-full md:w-auto">
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-2">
            {scribeEnabled && (
              <HeaderConsultationRecorder
                onBeforeStart={prepareFreshRecordingSession}
                onLiveTranscriptUpdate={handleLiveTranscriptUpdate}
                onLiveStopped={handleLiveStopped}
                onError={(msg: string) => onToast(msg, 'error')}
              />
            )}
            <button
              onClick={openUploadPicker}
              className="inline-flex h-14 min-w-[180px] items-center justify-center gap-2 rounded-[22px] border border-[#cfe3ef] bg-white px-5 text-sm font-semibold text-[#2f84b4] shadow-sm transition hover:border-[#9fd0e6] hover:bg-[#f2f9fd] hover:text-[#236f9b]"
            >
              <Upload className="w-4 h-4" /> Upload File
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileUpload}
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
          />
        </div>
      </div>

      <div className="border-b border-slate-200 bg-white px-4 md:px-8">
        <div className="mx-auto flex max-w-[1480px] gap-1 overflow-x-auto">
          {[
            { id: 'overview', label: 'Folder' },
            ...(scribeEnabled ? [{ id: 'notes', label: 'Scribe' }] : []),
            { id: 'chat', label: 'Agent' },
            ...(scribeEnabled ? [{ id: 'sessions', label: 'History' }] : []),
            ...(pdfFillerEnabled ? [{ id: 'form-intelligence', label: 'Form Intelligence' }] : []),
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`border-b-2 px-4 pb-3 pt-3 text-sm font-semibold transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-cyan-600 text-cyan-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:border-slate-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div
        className={`flex-1 min-h-0 ${
          activeTab === 'chat'
            ? 'overflow-hidden bg-[linear-gradient(180deg,#fbfdff_0%,#f5fbfe_100%)] px-0 py-0'
            : activeTab === 'notes'
              ? 'overflow-hidden bg-[linear-gradient(180deg,#fbfdff_0%,#f5f9fc_100%)] px-4 py-4 md:px-6 md:py-5'
            : activeTab === 'form-intelligence'
              ? 'overflow-hidden bg-slate-50/50 px-4 py-4 md:px-6 md:py-5'
            : 'overflow-y-auto bg-slate-50/50 px-4 py-4 md:px-6 md:py-5'
        }`}
      >
        <div
          className={
            activeTab === 'chat'
              ? 'h-full'
              : activeTab === 'notes'
                ? 'mx-auto h-full max-w-[1480px]'
                : activeTab === 'form-intelligence'
                  ? 'mx-auto flex h-full min-h-0 w-full max-w-6xl flex-1 flex-col overflow-hidden'
                : 'mx-auto max-w-6xl'
          }
        >

          {activeTab === 'overview' ? (
            <FileBrowser
              files={files}
              status={status}
              breadcrumbs={breadcrumbs}
              onNavigateToFolder={navigateToFolder}
              onNavigateBack={navigateBack}
              onNavigateToBreadcrumb={navigateToBreadcrumb}
              onStartEditFile={startEditFile}
              onDeleteFile={setFileToDelete}
              onViewFile={setViewingFile}
              onCreateFolder={() => setShowCreateFolderModal(true)}
            />
          ) : activeTab === 'sessions' ? (
            <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
              <div className="min-h-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Patient Summary
                    </span>
                    <p className="mt-1 text-sm text-slate-500">
                      Persistent summary sourced from <span className="font-medium text-slate-600">patient-summary.md</span>.
                    </p>
                  </div>
                  <FileText className="hidden h-5 w-5 text-cyan-500 md:block" />
                </div>

                {patientSummaryLoading ? (
                  <div className="flex h-[420px] items-center justify-center">
                    <Loader2 className="h-7 w-7 animate-spin text-cyan-500" />
                  </div>
                ) : (
                  <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-[#e4edf3] bg-[linear-gradient(180deg,#fbfdff_0%,#f6fafc_100%)]">
                    <div className="border-b border-slate-200 px-5 py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                        Current Snapshot
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        {parsedPatientSummary.lastUpdated
                          ? `Last updated ${parsedPatientSummary.lastUpdated}`
                          : 'Summary will appear here after the first upload or consultation.'}
                      </p>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                      <div className="space-y-6">
                        <div className="space-y-3">
                          {parsedPatientSummary.snapshot.length > 0 ? (
                            parsedPatientSummary.snapshot.map((bullet, index) => (
                              <div
                                key={`${bullet}-${index}`}
                                className="flex gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
                              >
                                <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-500" />
                                <p className="text-sm leading-6 text-slate-700">{bullet}</p>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-6 text-sm text-slate-400">
                              No persistent summary available yet.
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="mb-3 flex items-center gap-2">
                            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">
                              Timeline
                            </span>
                          </div>
                          <div className="space-y-3">
                            {parsedPatientSummary.timeline.length > 0 ? (
                              parsedPatientSummary.timeline.map((entry, index) => (
                                <div
                                  key={`${entry.heading}-${index}`}
                                  className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
                                >
                                  <p className="text-sm font-semibold text-slate-800">{entry.heading}</p>
                                  <div className="mt-3 space-y-2">
                                    {entry.bullets.map((bullet, bulletIndex) => (
                                      <div key={`${bullet}-${bulletIndex}`} className="flex gap-3">
                                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" />
                                        <p className="text-sm leading-6 text-slate-600">{bullet}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="rounded-2xl border border-dashed border-slate-200 bg-white/80 px-4 py-6 text-sm text-slate-400">
                                No recorded updates yet.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="min-h-0 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      Consultations {sessions.length > 0 && `(${sessions.length})`}
                    </span>
                    <p className="mt-1 text-sm text-slate-500">
                      Open any saved consultation to review its transcript and notes in Scribe.
                    </p>
                  </div>
                  <History className="hidden h-5 w-5 text-cyan-500 md:block" />
                </div>

                {sessionsLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-7 h-7 text-cyan-500 animate-spin" />
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center">
                    <p className="text-sm text-slate-400">
                      No sessions yet. Record a consultation and generate notes from the Scribe tab.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sessions.map(session => {
                      const createdDate = session.createdAt ? new Date(session.createdAt) : null;
                      const formattedDate = createdDate
                        ? createdDate.toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : 'Unknown date';
                      const labelTime = createdDate
                        ? createdDate.toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '';
                      const mainComplaint =
                        session.mainComplaint?.trim() ||
                        (session.notes && session.notes.length > 0
                          ? extractMainComplaint(session.notes[0].content)
                          : '');
                      const hasNotes = session.notes && session.notes.length > 0;
                      return (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => handleLoadSession(session)}
                          className="group flex w-full items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-left shadow-sm transition-all hover:border-cyan-200 hover:bg-cyan-50/50"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-[11px] font-bold text-slate-500 shrink-0">
                              {formattedDate.slice(0, 2)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-800">
                                {mainComplaint || 'Consultation'}
                              </p>
                              <p className="mt-0.5 text-xs text-slate-400">
                                {formattedDate}
                                {labelTime && ` - ${labelTime}`}
                                {hasNotes
                                  ? ` - ${session.notes!.length} note${session.notes!.length !== 1 ? 's' : ''}`
                                  : ' - transcript only'}
                              </p>
                            </div>
                          </div>
                          <ChevronRight
                            size={16}
                            className="shrink-0 text-slate-300 transition-colors group-hover:text-cyan-500"
                          />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'notes' ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-sm">
                  <span className="h-2 w-2 rounded-full bg-cyan-500" />
                  {activeSessionId
                    ? 'Viewing a saved session. Recording starts a fresh one.'
                    : 'Current consultation'}
                </div>
                {(currentTranscript || consultContext || notes.length > 0) && (
                  <button
                    type="button"
                    onClick={prepareFreshRecordingSession}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    Start fresh
                  </button>
                )}
              </div>

              <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[30px] border border-[#dbe9f1] bg-white shadow-[0_22px_55px_-36px_rgba(15,23,42,0.32)]">
                {pendingTranscript ? (
                  <div className="flex h-full min-h-0 flex-col overflow-hidden">
                    <div className="border-b border-slate-200 bg-white px-4 py-3 md:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">
                            Dictation ready for templates
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Review the transcript while you choose which note types to generate.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleCopyTranscript}
                          disabled={!pendingTranscript.trim()}
                          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {didCopyTranscript ? 'Copied' : 'Copy transcript'}
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#fbfdff_0%,#f5f9fc_100%)] px-4 py-4 md:px-5">
                      <div className="mx-auto max-w-[1320px] whitespace-pre-wrap rounded-[28px] border border-slate-200 bg-white px-5 py-5 text-sm leading-7 text-slate-700 shadow-sm">
                        {pendingTranscript}
                      </div>
                    </div>
                  </div>
                ) : notes.length === 0 ? (
                  <div className="flex h-full min-h-0 items-center justify-center px-6 py-10 text-slate-400">
                    {isGeneratingNotes ? (
                      <div className="flex w-full max-w-xs flex-col items-center gap-6 text-center">
                        <div className="relative h-16 w-16">
                          <div className="absolute inset-0 rounded-full border-4 border-sky-100" />
                          <div className="absolute inset-0 rounded-full border-4 border-sky-500 border-t-transparent animate-spin" />
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-sky-600" />
                          </div>
                        </div>
                        <div>
                          <p className="mb-1 text-sm font-semibold text-slate-700">
                            {NOTE_GENERATION_STEPS[noteGenerationStep]}…
                          </p>
                          <p className="text-xs text-slate-400">
                            Generating {selectedTemplatesForGenerate.length} note(s). This usually takes 15–30s.
                          </p>
                        </div>
                        <div className="flex justify-center gap-1.5">
                          {NOTE_GENERATION_STEPS.map((_, i) => (
                            <div
                              key={i}
                              className={`h-1.5 rounded-full transition-all duration-500 ${
                                i <= noteGenerationStep ? 'w-6 bg-sky-500' : 'w-3 bg-slate-200'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
                        <p className="text-sm text-slate-500">No notes yet.</p>
                        <p className="text-xs leading-6 text-slate-400">
                          Record a consultation to capture the transcript, then choose templates to generate structured notes and PDF previews.
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-5">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setConsultSubTab('context')}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                              consultSubTab === 'context'
                                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <Layers className="h-3.5 w-3.5" />
                            Context
                          </button>
                          <button
                            type="button"
                            onClick={() => setConsultSubTab('transcript')}
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                              consultSubTab === 'transcript'
                                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            Transcript
                          </button>
                          <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />
                          {notes.map((note, i) => (
                            <button
                              key={note.noteId}
                              type="button"
                              onClick={() => {
                                setConsultSubTab(i);
                              }}
                              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                                consultSubTab === i
                                  ? 'border-sky-200 bg-sky-50 text-sky-700 shadow-sm'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              {note.title || `Note ${i + 1}`}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setShowAddNoteModal(true);
                              setSelectedTemplatesForGenerate(['clinical_note']);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                            title="Add note or letter"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add note
                          </button>
                        </div>

                        <span className="text-xs text-slate-400">
                          {isLiveStreaming ? 'Live transcription in progress…' : ' '}
                        </span>
                      </div>
                    </div>

                    {consultSubTab === 'transcript' ? (
                      <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#fbfdff_0%,#f5f9fc_100%)] px-4 py-4 md:px-5">
                        <div className="mx-auto flex max-w-[1320px] flex-col gap-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-slate-800">
                              Consultation transcript
                            </p>
                            <button
                              type="button"
                              onClick={handleCopyTranscript}
                              disabled={!currentTranscript.trim()}
                              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              {didCopyTranscript ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                          <div className="min-h-[420px] whitespace-pre-wrap rounded-[28px] border border-slate-200 bg-white px-5 py-5 text-sm leading-7 text-slate-700 shadow-sm">
                            {currentTranscript || 'No transcript yet. Start a live consultation to see text appear here.'}
                          </div>
                        </div>
                      </div>
                    ) : consultSubTab === 'context' ? (
                      <div className="min-h-0 flex-1 overflow-y-auto bg-[linear-gradient(180deg,#fbfdff_0%,#f5f9fc_100%)] px-4 py-4 md:px-5">
                        <div className="mx-auto flex max-w-[1320px] flex-col gap-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">
                                Consultation context
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                Add any extra details you want HALO to keep in mind when generating or refining notes.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={handleContextUploadClick}
                                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                              >
                                <CloudUpload className="h-3.5 w-3.5" />
                                Upload from computer
                              </button>
                              <button
                                type="button"
                                onClick={openContextDrivePicker}
                                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                                Add from Drive
                              </button>
                            </div>
                          </div>
                          <textarea
                            value={consultContext}
                            onChange={e => setConsultContext(e.target.value)}
                            rows={8}
                            placeholder="e.g. Presenting complaint, differential diagnoses, or details you want reflected in the final note."
                            className="min-h-[420px] w-full resize-none rounded-[28px] border border-slate-200 bg-white px-5 py-5 text-sm leading-7 text-slate-800 shadow-sm outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                          />
                        </div>
                      </div>
                    ) : typeof consultSubTab === 'number' ? (
                      <div className="min-h-0 flex-1">
                        <NoteEditor
                          notes={notes}
                          activeIndex={consultSubTab}
                          onNoteChange={handleNoteChange}
                          status={status}
                          onSaveAsDocx={handleSaveAsDocx}
                          onSave={handleSaveAll}
                          onEmail={handleEmail}
                          onLoadPreview={loadNotePreview}
                          savingNoteIndex={savingNoteIndex}
                          previewUrls={notePreviewUrls}
                          previewErrors={notePreviewErrors}
                          previewSignatures={notePreviewSignatures}
                          previewLoadingNoteId={previewLoadingNoteId}
                          viewModes={noteViewModes}
                          onViewModeChange={(noteId, mode) =>
                            setNoteViewModes((prev) => ({ ...prev, [noteId]: mode }))
                          }
                        />
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              {/* Template choice modal — when new transcript or "+" add note; hide while generating */}
              {(pendingTranscript != null || showAddNoteModal) && !isGeneratingNotes && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
                  <div
                    className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="template-modal-title"
                  >
                    <div className="px-6 pt-5 pb-3 border-b border-slate-100">
                      <h3 id="template-modal-title" className="text-base font-bold text-slate-900 mb-1">
                        {showAddNoteModal ? 'Add note templates' : 'Choose note templates'}
                      </h3>
                      <p className="text-xs text-slate-500">
                        Select which note types to generate from your dictation. Each will appear as a separate tab for editing.
                      </p>
                    </div>
                    <div className="px-6 pb-6 pt-4 space-y-4">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={templateSearch}
                          onChange={e => setTemplateSearch(e.target.value)}
                          placeholder="Search or filter templates..."
                          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-800 placeholder-slate-400 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none"
                        />
                      </div>
                      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/60 divide-y divide-slate-100">
                        {templateOptions
                          .filter(t => {
                            if (!templateSearch.trim()) return true;
                            const q = templateSearch.toLowerCase();
                            return t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
                          })
                          .map(t => {
                            const selected = selectedTemplatesForGenerate.includes(t.id);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => toggleTemplateForGenerate(t.id)}
                                className={`w-full px-4 py-3 flex items-center justify-between text-sm font-medium transition-all ${
                                  selected
                                    ? 'bg-white text-sky-800'
                                    : 'bg-transparent text-slate-700 hover:bg-white'
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      selected ? 'bg-sky-500' : 'bg-slate-300'
                                    }`}
                                  />
                                  <span>{t.name}</span>
                                </span>
                                {selected && (
                                  <span className="text-[11px] font-semibold text-sky-600 uppercase tracking-wide">
                                    Selected
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        {templateOptions.length === 0 && (
                          <div className="px-4 py-6 text-xs text-slate-500 text-center">
                            No templates available. HALO will fall back to the default clinical note.
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 pt-2">
                        <button
                          type="button"
                          onClick={selectAllTemplatesForGenerate}
                          className="px-4 py-2 rounded-xl text-sm font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition shadow-sm"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerateFromTemplates}
                          disabled={selectedTemplatesForGenerate.length === 0 || isGeneratingNotes}
                          className="px-4 py-2 rounded-xl text-sm font-bold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm border border-sky-600"
                        >
                          {isGeneratingNotes
                            ? 'Generating…'
                            : showAddNoteModal
                              ? `Add ${selectedTemplatesForGenerate.length} note(s)`
                              : `Generate ${selectedTemplatesForGenerate.length} note(s)`}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setPendingTranscript(null); setShowAddNoteModal(false); }}
                          className="px-4 py-2 rounded-xl text-sm font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition shadow-sm"
                        >
                          Cancel
                        </button>
                      </div>
                      <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                        <p className="text-xs font-semibold text-slate-500">
                          Need a different kind of letter or motivation?
                        </p>
                        <p className="text-xs text-slate-500 mb-1">
                          Ask the Agent to draft a new note (e.g. a motivation letter) based on this patient&rsquo;s documentation and transcript.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setShowAddNoteModal(false);
                            setShowCustomAiNoteModal(true);
                            setCustomAiPrompt('');
                          }}
                          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white border border-cyan-200 text-cyan-700 hover:bg-cyan-50 hover:border-cyan-300 transition shadow-sm"
                        >
                          <MessageCircle className="w-4 h-4" /> Ask Agent to draft a custom note
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : activeTab === 'form-intelligence' ? (
            <PatientFormIntelligenceTab patient={patient} onToast={onToast} />
          ) : (
            <PatientChat
              chatMessages={chatMessages}
              chatInput={chatInput}
              onChatInputChange={setChatInput}
              chatLoading={chatLoading}
              chatLongWait={chatLongWait}
              onSendChat={handleSendChat}
              onToast={onToast}
            />
          )}
        </div>
      </div>

      {/* EDIT PATIENT MODAL */}
      {editingPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">Edit Patient Details</h3>
              <button onClick={() => setEditingPatient(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Full Name</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Date of Birth</label>
                <input type="date" value={editDob} onChange={e => setEditDob(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Sex</label>
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button onClick={() => setEditSex('M')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${editSex === 'M' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>M</button>
                  <button onClick={() => setEditSex('F')} className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${editSex === 'F' ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>F</button>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingPatient(false)} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
                <button onClick={savePatientEdit} className="flex-1 bg-sky-600 hover:bg-sky-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-sky-600/20 transition">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* BILLING DETAILS MODAL */}
      {editingBilling && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md m-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800">Billing Details</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Update medical aid and claim fields for this patient.
                </p>
              </div>
              <button
                onClick={() => setEditingBilling(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                  Medical Aid
                </label>
                <input
                  type="text"
                  value={editMedicalAid}
                  onChange={(e) => setEditMedicalAid(e.target.value)}
                  placeholder="e.g. Discovery"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                  Plan / Option
                </label>
                <input
                  type="text"
                  value={editMedicalAidPlan}
                  onChange={(e) => setEditMedicalAidPlan(e.target.value)}
                  placeholder="e.g. Classic Comprehensive"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                  Member Number
                </label>
                <input
                  type="text"
                  value={editMedicalAidNumber}
                  onChange={(e) => setEditMedicalAidNumber(e.target.value)}
                  placeholder="Member number"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                    Scheme Code
                  </label>
                  <input
                    type="text"
                    value={editSchemeCode}
                    onChange={(e) => setEditSchemeCode(e.target.value.toUpperCase())}
                    placeholder="e.g. DISC"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                    Plan Code
                  </label>
                  <input
                    type="text"
                    value={editPlanCode}
                    onChange={(e) => setEditPlanCode(e.target.value)}
                    placeholder="e.g. PLAN01"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                    Billing Member Number
                  </label>
                  <input
                    type="text"
                    value={editMemberNumber}
                    onChange={(e) => setEditMemberNumber(e.target.value)}
                    placeholder="e.g. MK1050533"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                    Dependant Code
                  </label>
                  <input
                    type="text"
                    value={editDependantCode}
                    onChange={(e) => setEditDependantCode(e.target.value)}
                    placeholder="e.g. 01"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                    Patient Initials
                  </label>
                  <input
                    type="text"
                    value={editInitials}
                    onChange={(e) => setEditInitials(e.target.value.toUpperCase())}
                    placeholder="e.g. JD"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                    Status Indicator
                  </label>
                  <input
                    type="text"
                    value={editStatusIndicator}
                    onChange={(e) => setEditStatusIndicator(e.target.value.toUpperCase())}
                    placeholder="e.g. A"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                  />
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Family folder</p>
                <div className="mt-2">
                  <label className="block text-sm font-semibold text-slate-600 mb-1.5">
                    Family folder name
                  </label>
                  <input
                    type="text"
                    value={editFamilyName}
                    onChange={(e) => setEditFamilyName(e.target.value)}
                    placeholder="e.g. Sunny Family"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                  />
                </div>
                {suggestedSurnameMembers.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Suggested by surname</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {suggestedSurnameMembers.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleFamilyMemberSelection(member.id)}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-sky-400 hover:text-sky-700"
                        >
                          + {member.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {suggestedPlanMembers.length > 0 ? (
                  <div className="mt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Suggested by plan/member</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {suggestedPlanMembers.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleFamilyMemberSelection(member.id)}
                          className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:border-sky-400 hover:text-sky-700"
                        >
                          + {member.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-3 max-h-36 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 px-1 pb-1">Manual members</p>
                  {allOtherPatients.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-slate-500">No other patients available.</p>
                  ) : (
                    <div className="space-y-1">
                      {allOtherPatients.map((member) => (
                        <label key={member.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm text-slate-700 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            checked={editFamilyMemberIds.includes(member.id)}
                            onChange={() => toggleFamilyMemberSelection(member.id)}
                            className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                          />
                          <span className="truncate">{member.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Same-surname and same-plan suggestions help, but you can manually add any patient to the family folder.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setEditingBilling(false)}
                  className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={saveBillingEdit}
                  className="flex-1 bg-sky-600 hover:bg-sky-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-sky-600/20 transition"
                >
                  Save Billing
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RENAME MODAL */}
      {editingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">
                Rename {isFolder(editingFile) ? 'Folder' : 'File'}
              </h3>
              <button onClick={() => setEditingFile(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Name</label>
                <input type="text" value={editFileName} onChange={e => setEditFileName(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition" />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditingFile(null)} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
                <button onClick={saveFileEdit} className="flex-1 bg-sky-600 hover:bg-sky-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-sky-600/20 transition">Save Changes</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DELETE FILE CONFIRMATION MODAL */}
      {fileToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 m-4 border-2 border-rose-100">
            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-14 h-14 bg-rose-50 rounded-full flex items-center justify-center mb-3 text-rose-500">
                <Trash2 size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Delete File?</h3>
              <p className="text-slate-500 mt-2 text-sm px-4">
                Move <span className="font-bold text-slate-700">{fileToDelete.name}</span> to trash?
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setFileToDelete(null)} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
              <button onClick={confirmDeleteFile} className="flex-1 bg-rose-500 hover:bg-rose-600 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-rose-500/20 transition">Delete</button>
            </div>
          </div>
        </div>
      )}

      {status === AppStatus.SAVING && (
        <div className="fixed inset-0 bg-white/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-slate-200 rounded-full"></div>
            <div className="absolute top-0 left-0 w-16 h-16 border-4 border-sky-500 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="text-sky-900 font-bold text-lg mt-6">Saving note as DOCX...</p>
          <p className="text-slate-500 text-sm mt-1">Uploading to Patient Notes folder</p>
        </div>
      )}

      {/* NOTE GENERATION OVERLAY */}
      {isGeneratingNotes && (
        <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-[2px] z-40 flex items-center justify-center pointer-events-none">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl px-7 py-6 flex flex-col items-center gap-3 max-w-xs text-center pointer-events-auto">
            <div className="relative mb-1">
              <div className="w-12 h-12 rounded-full border-2 border-slate-100" />
              <div className="absolute inset-0 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin" />
            </div>
            <p className="text-sm font-bold text-slate-800">Preparing your notes…</p>
            <div className="w-full space-y-2.5">
              {NOTE_GENERATION_STEPS.map((label, index) => {
                const done = index < noteGenerationStep;
                const active = index === noteGenerationStep;
                return (
                  <div key={index} className="flex items-center gap-2.5 text-left">
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 transition-colors ${
                        done ? 'bg-emerald-400' : active ? 'bg-cyan-500 animate-pulse' : 'bg-slate-200'
                      }`}
                    />
                    <span
                      className={`text-xs transition-colors ${
                        done ? 'text-slate-400 line-through' : active ? 'font-semibold text-slate-800' : 'text-slate-400'
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Usually a few seconds. Review your transcript while you wait.
            </p>
          </div>
        </div>
      )}

      {/* UPLOAD DESTINATION PICKER MODAL */}
      {showUploadPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">Upload Destination</h3>
              <button onClick={() => setShowUploadPicker(false)} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"><X size={20} /></button>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">Uploading to:</label>
              <div className="flex items-center gap-2 bg-sky-50 border border-sky-100 px-3 py-2 rounded-lg">
                <FolderOpen size={16} className="text-sky-600 shrink-0" />
                <span className="text-sm font-semibold text-sky-700 truncate">{uploadTargetLabel}</span>
              </div>
            </div>
            <div className="mb-4">
              {uploadPickerLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 size={20} className="text-sky-500 animate-spin" />
                </div>
              ) : uploadPickerFolders.length > 0 ? (
                <div className="max-h-48 overflow-y-auto space-y-1.5 border border-slate-100 rounded-lg p-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-1">Or choose a subfolder:</p>
                  {uploadPickerFolders.map(folder => (
                    <button
                      key={folder.id}
                      onClick={() => selectUploadFolder(folder)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm font-medium text-slate-700 hover:bg-sky-50 hover:text-sky-700 transition-colors"
                    >
                      <FolderOpen size={15} className="text-sky-500 shrink-0" />
                      <span className="truncate">{folder.name}</span>
                      <ChevronRight size={14} className="text-slate-300 ml-auto shrink-0" />
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 text-center py-3">No subfolders available</p>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowUploadPicker(false)} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
              <button onClick={confirmUploadDestination} className="flex-1 bg-sky-600 hover:bg-sky-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-sky-600/20 transition flex items-center justify-center gap-2">
                <Upload size={16} /> Choose File
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONTEXT DRIVE PICKER MODAL */}
      {showContextDrivePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-slate-800">Add files from Drive</span>
                <span className="text-xs text-slate-500">
                  Choose files from this patient&apos;s Google Drive folder to reference in your context.
                </span>
              </div>
              <button
                onClick={() => {
                  setShowContextDrivePicker(false);
                  setContextDriveSelectedIds([]);
                }}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {contextDriveLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
                </div>
              ) : contextDriveFiles.filter((f) => !isFolder(f)).length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">
                  No files found in this patient&apos;s Drive folder yet.
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/60 divide-y divide-slate-100">
                  {contextDriveFiles
                    .filter((f) => !isFolder(f))
                    .map((file) => {
                      const checked = contextDriveSelectedIds.includes(file.id);
                      return (
                        <label
                          key={file.id}
                          className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-white cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleContextDriveSelection(file.id)}
                            className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                          />
                          <span className="truncate">{file.name}</span>
                        </label>
                      );
                    })}
                </div>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-3 justify-end bg-slate-50/80">
              <button
                type="button"
                onClick={() => {
                  setShowContextDrivePicker(false);
                  setContextDriveSelectedIds([]);
                }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={contextDriveSelectedIds.length === 0}
                onClick={applyContextDriveSelection}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              >
                Add to context
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FILE VIEWER MODAL */}
      {viewingFile && (
        <FileViewer
          fileId={viewingFile.id}
          fileName={viewingFile.name}
          mimeType={viewingFile.mimeType}
          fileUrl={viewingFile.url}
          onClose={() => setViewingFile(null)}
        />
      )}

      {/* CREATE FOLDER MODAL */}
      {showCreateFolderModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm m-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">New Folder</h3>
              <button onClick={() => { setShowCreateFolderModal(false); setNewFolderName(""); }} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Creating folder in:</label>
                <p className="text-sm font-semibold text-sky-700 bg-sky-50 px-3 py-2 rounded-lg border border-sky-100">
                  {breadcrumbs.map(b => b.name).join(' / ')}
                </p>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-600 mb-1.5">Folder Name</label>
                <input
                  type="text"
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); }}
                  placeholder="e.g. Lab Results, Imaging..."
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none transition"
                  autoFocus
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowCreateFolderModal(false); setNewFolderName(""); }} className="flex-1 px-4 py-3 rounded-xl font-medium text-slate-600 hover:bg-slate-100 transition">Cancel</button>
                <button onClick={handleCreateFolder} disabled={!newFolderName.trim()} className="flex-1 bg-sky-600 hover:bg-sky-700 text-white px-4 py-3 rounded-xl font-bold shadow-lg shadow-sky-600/20 transition disabled:opacity-50 flex items-center justify-center gap-2">
                  <FolderPlus size={16} /> Create
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM AI NOTE MODAL */}
      {showCustomAiNoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-slate-800">Ask Agent to draft a custom note</span>
                <span className="text-xs text-slate-500">
                  Describe what you need (e.g. &ldquo;Motivation for MRI&rdquo;, &ldquo;Sick note&rdquo;). The agent will draft it using this patient&rsquo;s documentation and transcript.
                </span>
              </div>
              <button
                onClick={() => {
                  setShowCustomAiNoteModal(false);
                  setCustomAiPrompt('');
                }}
                className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <textarea
                value={customAiPrompt}
                onChange={(e) => setCustomAiPrompt(e.target.value)}
                rows={4}
                placeholder="e.g. Draft a medical motivation letter explaining why this patient requires a CT scan based on their current findings and history."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:bg-white focus:border-sky-500 focus:ring-2 focus:ring-sky-100 outline-none resize-none"
              />
              <p className="text-[11px] text-slate-500">
                The agent will use the same context as the <span className="font-semibold">Agent</span> tab, plus your latest transcript, to generate the note.
              </p>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex gap-3 justify-end bg-slate-50/80">
              <button
                type="button"
                onClick={() => {
                  setShowCustomAiNoteModal(false);
                  setCustomAiPrompt('');
                }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!customAiPrompt.trim() || customAiLoading}
                onClick={async () => {
                  const prompt = customAiPrompt.trim();
                  if (!prompt) return;
                  setCustomAiLoading(true);
                  try {
                    const historyForContext = chatMessagesRef.current || [];
                    const response = await askHalo(patient.id, prompt, historyForContext);
                    const content = response.reply?.trim();
                    if (!content) {
                      onToast('HALO did not return any text for this request. Please try again.', 'error');
                    } else {
                      const title = prompt.length > 60 ? `${prompt.slice(0, 57)}…` : prompt;
                      const newNote: HaloNote = {
                        noteId: `custom-${Date.now()}`,
                        title: title || 'Custom note',
                        content,
                        template_id: 'jon_note',
                        lastSavedAt: new Date().toISOString(),
                        dirty: true,
                      };
                      setNotes((prev) => [...prev, newNote]);
                      const newIndex = notes.length;
                      setConsultSubTab(newIndex);
                      setShowCustomAiNoteModal(false);
                      setCustomAiPrompt('');
                      onToast('Custom note drafted. You can edit and save it as DOCX.', 'success');
                    }
                  } catch (err) {
                    onToast(getErrorMessage(err), 'error');
                  }
                  setCustomAiLoading(false);
                }}
                className="px-4 py-2 rounded-xl text-sm font-semibold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-2"
              >
                {customAiLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Drafting…
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-4 h-4" /> Draft note
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
