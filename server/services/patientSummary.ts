import { generateText, safeJsonParse } from './gemini';
import {
  downloadTextFromDrive,
  driveRequest,
  extractTextFromFile,
  fetchAllFilesInFolder,
  findFileInFolder,
  parseFolderString,
  readJsonFileFromDrive,
  upsertJsonFileInFolder,
  upsertTextFileInFolder,
} from './drive';
import {
  patientSummaryMergePrompt,
  patientSummarySourcePrompt,
} from '../utils/prompts';
import { parseSessionsJson } from '../utils/scribeSessions';
import type {
  PatientSummaryProcessedSource,
  PatientSummaryState,
  PatientSummaryTimelineEntry,
  ScribeSession,
} from '../../shared/types';

const SUMMARY_MARKDOWN_FILE_NAME = 'patient-summary.md';
const SUMMARY_STATE_FILE_NAME = 'halo_patient_summary_state.json';
const SESSIONS_FILE_NAME = 'halo_scribe_sessions.json';
const MAX_TIMELINE_ENTRIES = 80;

type SummarySource = {
  sourceId: string;
  sourceType: 'file' | 'consultation';
  sourceName: string;
  sourceUpdatedAt: string;
  happenedAt: string;
  text: string;
};

function dateOnly(isoLike: string | undefined): string {
  if (!isoLike) return new Date().toISOString().split('T')[0];
  return isoLike.split('T')[0];
}

function normalizeBulletList(items: unknown, maxItems = 5): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

function createEmptySummaryState(patientId: string, patientName: string): PatientSummaryState {
  return {
    version: 1,
    patientId,
    patientName,
    lastUpdatedAt: null,
    dirty: true,
    snapshot: [],
    timeline: [],
    processedSources: {},
  };
}

function normalizeSummaryState(
  raw: unknown,
  patientId: string,
  patientName: string
): PatientSummaryState {
  const base = createEmptySummaryState(patientId, patientName);
  if (!raw || typeof raw !== 'object') return base;

  const obj = raw as Partial<PatientSummaryState>;
  const timeline: PatientSummaryTimelineEntry[] = [];
  if (Array.isArray(obj.timeline)) {
    for (const entry of obj.timeline) {
      const item = entry as Partial<PatientSummaryTimelineEntry>;
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.sourceId !== 'string' ||
        typeof item.sourceType !== 'string' ||
        typeof item.title !== 'string' ||
        typeof item.happenedAt !== 'string'
      ) {
        continue;
      }
      timeline.push({
        id: item.id,
        sourceId: item.sourceId,
        sourceType: item.sourceType === 'consultation' ? 'consultation' : 'file',
        title: item.title,
        dateLabel: typeof item.dateLabel === 'string' ? item.dateLabel : dateOnly(item.happenedAt),
        happenedAt: item.happenedAt,
        bullets: normalizeBulletList(item.bullets, 3),
        sourceName: typeof item.sourceName === 'string' ? item.sourceName : undefined,
      });
    }
  }

  const processedSources: Record<string, PatientSummaryProcessedSource> = {};
  if (obj.processedSources && typeof obj.processedSources === 'object') {
    for (const [key, value] of Object.entries(obj.processedSources)) {
      const item = value as Partial<PatientSummaryProcessedSource>;
      if (
        item &&
        typeof item.sourceId === 'string' &&
        typeof item.sourceType === 'string' &&
        typeof item.sourceName === 'string' &&
        typeof item.sourceUpdatedAt === 'string' &&
        typeof item.processedAt === 'string'
      ) {
        processedSources[key] = {
          sourceId: item.sourceId,
          sourceType: item.sourceType === 'consultation' ? 'consultation' : 'file',
          sourceName: item.sourceName,
          sourceUpdatedAt: item.sourceUpdatedAt,
          processedAt: item.processedAt,
        };
      }
    }
  }

  return {
    version: typeof obj.version === 'number' ? obj.version : 1,
    patientId,
    patientName: typeof obj.patientName === 'string' && obj.patientName.trim() ? obj.patientName : patientName,
    lastUpdatedAt: typeof obj.lastUpdatedAt === 'string' ? obj.lastUpdatedAt : null,
    dirty: typeof obj.dirty === 'boolean' ? obj.dirty : base.dirty,
    snapshot: normalizeBulletList(obj.snapshot, 5),
    timeline,
    processedSources,
  };
}

function buildPatientSummaryMarkdown(state: PatientSummaryState): string {
  const lines: string[] = ['# Patient Summary', ''];
  lines.push(`Last updated: ${state.lastUpdatedAt || 'Not yet generated'}`);
  lines.push('', '## Current Snapshot', '');

  if (state.snapshot.length > 0) {
    for (const bullet of state.snapshot) {
      lines.push(`- ${bullet}`);
    }
  } else {
    lines.push('- No clinical summary available yet.');
  }

  lines.push('', '## Timeline', '');

  if (state.timeline.length > 0) {
    for (const entry of state.timeline) {
      lines.push(`### ${entry.dateLabel} - ${entry.title}`, '');
      for (const bullet of entry.bullets) {
        lines.push(`- ${bullet}`);
      }
      lines.push('');
    }
  } else {
    lines.push('- No recorded updates yet.', '');
  }

  return `${lines.join('\n').trim()}\n`;
}

function buildConsultationSourceText(session: ScribeSession): string {
  const parts: string[] = [];

  if (session.context?.trim()) {
    parts.push(`Context:\n${session.context.trim()}`);
  }

  if (session.notes && session.notes.length > 0) {
    const noteText = session.notes
      .map((note) => `--- ${note.title || 'Generated note'} ---\n${note.content || ''}`)
      .join('\n\n')
      .trim();
    if (noteText) parts.push(`Generated notes:\n${noteText}`);
  }

  if (session.transcript.trim()) {
    parts.push(`Transcript:\n${session.transcript.trim()}`);
  }

  return parts.join('\n\n').slice(0, 5000);
}

function shouldSkipSummaryFile(file: {
  name: string;
  mimeType: string;
  appProperties?: Record<string, string>;
}): boolean {
  if (file.mimeType === 'application/vnd.google-apps.folder') return true;
  if (file.name === SUMMARY_MARKDOWN_FILE_NAME || file.name === SUMMARY_STATE_FILE_NAME) return true;
  if (file.name === SESSIONS_FILE_NAME) return true;
  if (file.name.startsWith('.halo-warm-') && file.name.endsWith('.tmp')) return true;
  if (file.appProperties?.internalType === 'halo_note_export') return true;
  if (file.appProperties?.haloGenerated === 'true') return true;
  return false;
}

async function resolvePatientName(token: string, patientId: string): Promise<string> {
  const meta = await driveRequest(token, `/files/${patientId}?fields=name,appProperties`);
  const patientName = meta.appProperties?.patientName;
  if (patientName && patientName.trim()) return patientName.trim();
  if (meta.name && meta.name.includes('__')) {
    const parsed = parseFolderString(meta.name);
    if (parsed?.pName) return parsed.pName;
  }
  return meta.name || 'Patient';
}

async function readSummaryState(token: string, patientId: string, patientName: string): Promise<PatientSummaryState> {
  const stateFile = await findFileInFolder(token, patientId, SUMMARY_STATE_FILE_NAME, 'application/json');
  if (!stateFile) return createEmptySummaryState(patientId, patientName);
  const raw = await readJsonFileFromDrive<unknown>(token, stateFile.id, null);
  return normalizeSummaryState(raw, patientId, patientName);
}

async function saveSummaryState(token: string, patientId: string, state: PatientSummaryState): Promise<void> {
  await upsertJsonFileInFolder(token, patientId, SUMMARY_STATE_FILE_NAME, state, {
    internalType: 'patient_summary_state',
  });
}

async function saveSummaryMarkdown(token: string, patientId: string, state: PatientSummaryState): Promise<string> {
  return upsertTextFileInFolder(
    token,
    patientId,
    SUMMARY_MARKDOWN_FILE_NAME,
    buildPatientSummaryMarkdown(state),
    'text/markdown'
  );
}

async function loadConsultationSources(token: string, patientId: string): Promise<SummarySource[]> {
  const sessionsFile = await findFileInFolder(token, patientId, SESSIONS_FILE_NAME, 'application/json');
  if (!sessionsFile) return [];

  const rawText = await downloadTextFromDrive(token, sessionsFile.id);
  const sessions = parseSessionsJson(JSON.parse(rawText) as unknown);
  const sources: SummarySource[] = [];
  for (const session of sessions) {
    const text = buildConsultationSourceText(session);
    if (!text.trim()) continue;
    sources.push({
      sourceId: `session:${session.id}`,
      sourceType: 'consultation',
      sourceName:
        session.mainComplaint?.trim() ||
        session.noteTitles?.[0] ||
        'Consultation',
      sourceUpdatedAt: session.createdAt,
      happenedAt: session.createdAt,
      text,
    });
  }
  return sources;
}

async function loadFileSources(token: string, patientId: string): Promise<SummarySource[]> {
  const files = await fetchAllFilesInFolder(token, patientId);
  const relevant = files.filter((file) => !shouldSkipSummaryFile(file));
  const sources: SummarySource[] = [];

  for (const file of relevant) {
    const text = await extractTextFromFile(token, file, 5000);
    if (!text.trim()) continue;
    const updatedAt = file.modifiedTime || file.createdTime || new Date().toISOString();
    sources.push({
      sourceId: `file:${file.id}`,
      sourceType: 'file',
      sourceName: file.name,
      sourceUpdatedAt: updatedAt,
      happenedAt: updatedAt,
      text,
    });
  }

  return sources;
}

async function buildAllSummarySources(token: string, patientId: string): Promise<SummarySource[]> {
  const [fileSources, consultationSources] = await Promise.all([
    loadFileSources(token, patientId),
    loadConsultationSources(token, patientId),
  ]);

  return [...fileSources, ...consultationSources].sort((a, b) =>
    a.happenedAt.localeCompare(b.happenedAt)
  );
}

async function extractSummaryEntry(
  patientName: string,
  source: SummarySource
): Promise<Pick<PatientSummaryTimelineEntry, 'title' | 'bullets'>> {
  const prompt = patientSummarySourcePrompt({
    patientName,
    sourceType: source.sourceType,
    sourceName: source.sourceName,
    sourceDate: dateOnly(source.happenedAt),
    content: source.text,
  });
  const raw = await generateText(prompt);
  const parsed = safeJsonParse<{ title?: string; bullets?: string[] }>(raw, {
    title: source.sourceName,
    bullets: [],
  });
  const bullets = normalizeBulletList(parsed.bullets, 3);
  return {
    title: (parsed.title || source.sourceName || 'Update').trim(),
    bullets: bullets.length > 0 ? bullets : [`Updated from ${source.sourceName}.`],
  };
}

async function mergeSnapshot(
  patientName: string,
  state: PatientSummaryState,
  newestEntry: PatientSummaryTimelineEntry
): Promise<string[]> {
  const recentTimeline = [...state.timeline]
    .sort((a, b) => b.happenedAt.localeCompare(a.happenedAt))
    .slice(0, 6)
    .map((entry) => ({
      date: entry.dateLabel,
      title: entry.title,
      bullets: entry.bullets,
    }));

  const raw = await generateText(
    patientSummaryMergePrompt({
      patientName,
      currentSnapshot: state.snapshot,
      recentTimeline,
      newUpdate: {
        title: newestEntry.title,
        date: newestEntry.dateLabel,
        bullets: newestEntry.bullets,
      },
    })
  );
  const parsed = safeJsonParse<{ snapshot?: string[] }>(raw, {
    snapshot: newestEntry.bullets,
  });
  const snapshot = normalizeBulletList(parsed.snapshot, 5);
  return snapshot.length > 0 ? snapshot : newestEntry.bullets.slice(0, 5);
}

function upsertTimelineEntry(
  timeline: PatientSummaryTimelineEntry[],
  entry: PatientSummaryTimelineEntry
): PatientSummaryTimelineEntry[] {
  const next = [...timeline.filter((item) => item.id !== entry.id), entry];
  next.sort((a, b) => b.happenedAt.localeCompare(a.happenedAt));
  return next.slice(0, MAX_TIMELINE_ENTRIES);
}

function hasPendingSummaryUpdates(
  state: PatientSummaryState,
  sources: SummarySource[]
): boolean {
  return sources.some((source) => {
    const processed = state.processedSources[source.sourceId];
    return !processed || processed.sourceUpdatedAt !== source.sourceUpdatedAt;
  });
}

async function renderAndPersistSummary(
  token: string,
  patientId: string,
  state: PatientSummaryState
): Promise<{ markdown: string; state: PatientSummaryState }> {
  const finalState = {
    ...state,
    lastUpdatedAt: new Date().toISOString(),
    dirty: false,
  };
  await Promise.all([
    saveSummaryState(token, patientId, finalState),
    saveSummaryMarkdown(token, patientId, finalState),
  ]);
  return { markdown: buildPatientSummaryMarkdown(finalState), state: finalState };
}

export async function markPatientSummaryDirty(token: string, patientId: string): Promise<void> {
  const patientName = await resolvePatientName(token, patientId);
  const state = await readSummaryState(token, patientId, patientName);
  state.patientName = patientName;
  state.dirty = true;
  await saveSummaryState(token, patientId, state);
}

export async function ensurePatientSummaryUpToDate(
  token: string,
  patientId: string
): Promise<{ markdown: string; state: PatientSummaryState }> {
  const patientName = await resolvePatientName(token, patientId);
  let state = await readSummaryState(token, patientId, patientName);
  state.patientName = patientName;

  const sources = await buildAllSummarySources(token, patientId);
  const pendingSources = sources.filter((source) => {
    const processed = state.processedSources[source.sourceId];
    return !processed || processed.sourceUpdatedAt !== source.sourceUpdatedAt;
  });

  if (pendingSources.length === 0 && !state.dirty) {
    const summaryFile = await findFileInFolder(token, patientId, SUMMARY_MARKDOWN_FILE_NAME);
    if (summaryFile) {
      const markdown = await downloadTextFromDrive(token, summaryFile.id);
      return { markdown, state };
    }
    return renderAndPersistSummary(token, patientId, state);
  }

  for (const source of pendingSources) {
    const extracted = await extractSummaryEntry(patientName, source);
    const timelineEntry: PatientSummaryTimelineEntry = {
      id: `${source.sourceId}:${source.sourceUpdatedAt}`,
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      title: extracted.title,
      dateLabel: dateOnly(source.happenedAt),
      happenedAt: source.happenedAt,
      bullets: extracted.bullets,
      sourceName: source.sourceName,
    };

    state.timeline = upsertTimelineEntry(state.timeline, timelineEntry);
    state.snapshot = await mergeSnapshot(patientName, state, timelineEntry);
    state.processedSources[source.sourceId] = {
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      sourceName: source.sourceName,
      sourceUpdatedAt: source.sourceUpdatedAt,
      processedAt: new Date().toISOString(),
    };
  }

  if (pendingSources.length === 0 && state.dirty && !hasPendingSummaryUpdates(state, sources)) {
    state.snapshot = state.snapshot.length > 0 ? state.snapshot : [];
  }

  return renderAndPersistSummary(token, patientId, state);
}

export async function refreshPatientSummaryInBackground(
  token: string,
  patientId: string
): Promise<void> {
  try {
    await ensurePatientSummaryUpToDate(token, patientId);
  } catch (err) {
    console.error(`[summary] Background refresh failed for ${patientId}:`, err);
  }
}

export { SUMMARY_MARKDOWN_FILE_NAME, SUMMARY_STATE_FILE_NAME };
