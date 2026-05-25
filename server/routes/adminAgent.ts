import express, { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { driveRequest, getHaloRootFolder } from '../services/drive';
import { config } from '../config';
import {
  getVpsJwt,
  getVpsConfig,
  setVpsConfig,
  getBillingCap,
  setBillingCap,
  markSetupDone,
  getOnedriveAuthUrl,
  getOnedriveStatus,
  triggerOnedriveSetup,
  getTier,
  setTier,
  getTokenUsage,
  incrementTokenUsage,
  getAutomations,
  saveAutomations,
  resolveVpsJwt,
} from '../services/vpsApi';
import type { Automation } from '../agent/capabilities';
import { registerSession } from '../jobs/automationRunner';

const router = Router();
router.use(requireAuth);


const DRIVE_SUBFOLDER_NAMES = ['Black Hole', 'Patients', 'Review', 'Billing', 'Archive'] as const;
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// --- Drive helpers ---

function extractDriveFileId(url: string): string | null {
  const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

async function getOrCreateLettersFolder(token: string, patientFolderId: string): Promise<string | null> {
  try {
    const q = encodeURIComponent(`'${patientFolderId}' in parents and name='Letters' and mimeType='${FOLDER_MIME}' and trashed=false`);
    const existing = await driveRequest(token, `/files?q=${q}&fields=files(id)`) as { files?: Array<{ id: string }> };
    if (existing.files?.[0]?.id) return existing.files[0].id;
    const r = await fetch(`${config.driveApi}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Letters', mimeType: FOLDER_MIME, parents: [patientFolderId] }),
    });
    const created = await r.json() as { id: string };
    return created.id ?? null;
  } catch { return null; }
}

async function moveDriveFile(token: string, fileId: string, newParentId: string): Promise<void> {
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = await metaRes.json() as { parents?: string[] };
  const params = new URLSearchParams({ addParents: newParentId, fields: 'id' });
  const removeParents = (meta.parents ?? []).join(',');
  if (removeParents) params.set('removeParents', removeParents);
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
}

async function trashDriveFile(token: string, fileId: string): Promise<void> {
  await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  });
}

async function labelGmailThread(token: string, threadId: string, labelName: string): Promise<void> {
  const labelsRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const labelsData = await labelsRes.json() as { labels?: Array<{ id: string; name: string }> };
  let labelId = labelsData.labels?.find(l => l.name === labelName)?.id;
  if (!labelId) {
    const createRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    const created = await createRes.json() as { id: string };
    labelId = created.id;
  }
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${threadId}/modify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ addLabelIds: [labelId] }),
  });
}

// Collect an SSE stream from VPS /agent/chat into a plain string.
async function collectVpsStream(vpsRes: globalThis.Response): Promise<string> {
  const reader = vpsRes.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
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
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data) as string;
            if (typeof parsed === 'string') fullText += parsed;
          } catch { /* ignore malformed chunks */ }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return fullText.trim();
}

// --- Memory ---

function defaultMemory(settings: Record<string, string>): string {
  const name = [settings.firstName, settings.lastName].filter(Boolean).join(' ') || 'Doctor';
  const lines: string[] = [
    `# ${name} — Admin Agent Memory`,
    '',
    '## Profile',
  ];
  if (settings.profession) lines.push(`**Specialty:** ${settings.profession}`);
  if (settings.department) lines.push(`**Department:** ${settings.department}`);
  if (settings.city) lines.push(`**City:** ${settings.city}`);
  if (settings.university) lines.push(`**University:** ${settings.university}`);
  lines.push('', '## Preferences', '', '## Notes', '', '## Active Automations', '');
  return lines.join('\n');
}

// GET /api/admin-agent/memory
router.get('/memory', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const existing = await getVpsConfig(vpsJwt, 'agent_memory');
    if (existing) {
      res.json({ markdown: existing });
      return;
    }
    const settingsRaw = await getVpsConfig(vpsJwt, 'user_settings');
    let settings: Record<string, string> = {};
    if (settingsRaw) {
      try { settings = JSON.parse(settingsRaw); } catch { /* ignore */ }
    }
    const markdown = defaultMemory(settings);
    await setVpsConfig(vpsJwt, 'agent_memory', markdown);
    res.json({ markdown });
  } catch (err) {
    console.error('Admin agent memory GET error:', err);
    res.status(500).json({ error: 'Failed to load agent memory.' });
  }
});

// PUT /api/admin-agent/memory
router.put('/memory', async (req: Request, res: Response) => {
  try {
    const { markdown } = req.body as { markdown?: string };
    if (typeof markdown !== 'string') {
      res.status(400).json({ error: 'markdown is required.' });
      return;
    }
    const vpsJwt = await resolveVpsJwt(req);
    await setVpsConfig(vpsJwt, 'agent_memory', markdown);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin agent memory PUT error:', err);
    res.status(500).json({ error: 'Failed to save agent memory.' });
  }
});

// --- Tasks ---

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AgentTask {
  id: string;
  title: string;
  done: boolean;
  createdAt: string;
  dueAt?: string | null;
  // Taxonomy: category determines which pile the task lands in
  category?: 'agent' | 'doctor';
  // Source: who/what created this task — used for card rendering and discard behaviour
  source?: string | null;
  status?: 'running' | 'complete' | 'failed';
  completedAt?: string | null;
  actionUrl?: string | null;
  agentNote?: string | null;
  // Drive file ID for direct file operations (approve/discard). Extracted from actionUrl if absent.
  driveFileId?: string | null;
  // Persisted discussion thread between doctor and agent on this specific task
  conversation?: ConversationMessage[] | null;
  // Patient metadata — populated by VPS; required for Approve filing flow
  patientName?: string | null;
  documentType?: string | null;
  patientFolderId?: string | null;
  // Black Hole approve routing fields
  targetSubfolder?: string | null;
  reviewFileId?: string | null;
  reviewFormat?: string | null;
  // Task type discriminator — drives VPS card-chat system prompt selection
  taskType?: string | null;
  // Case ID — links to intake_cases row; present on unidentified_bundle tasks for reprocessing
  caseId?: string | null;
  // Unidentified bundle context fields
  capturedAt?: string | null;
  transcriptionPreview?: string | null;
  photoCount?: number | null;
  hasAudio?: boolean | null;
  // Email metadata — populated by email_monitor
  emailFrom?: string | null;
  emailSubject?: string | null;
  threadId?: string | null;
}

function parseTasks(raw: unknown): AgentTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (t): t is AgentTask =>
      t && typeof t === 'object' && typeof (t as AgentTask).id === 'string'
  );
}

async function loadTasks(vpsJwt: string): Promise<AgentTask[]> {
  const raw = await getVpsConfig(vpsJwt, 'agent_tasks');
  return raw ? parseTasks(JSON.parse(raw)) : [];
}

async function saveTasks(vpsJwt: string, tasks: AgentTask[]): Promise<void> {
  await setVpsConfig(vpsJwt, 'agent_tasks', JSON.stringify(tasks));
}

// GET /api/admin-agent/tasks
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    res.json({ tasks: await loadTasks(vpsJwt) });
  } catch (err) {
    console.error('Admin agent tasks GET error:', err);
    res.status(500).json({ error: 'Failed to load tasks.' });
  }
});

// POST /api/admin-agent/tasks
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const { title, dueAt, category, source, status, agentNote } = req.body as {
      title?: string;
      dueAt?: string;
      category?: 'agent' | 'doctor';
      source?: string;
      status?: 'running' | 'complete' | 'failed';
      agentNote?: string;
    };
    if (!title?.trim()) {
      res.status(400).json({ error: 'title is required.' });
      return;
    }
    const vpsJwt = await resolveVpsJwt(req);
    const tasks = await loadTasks(vpsJwt);
    const task: AgentTask = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      done: false,
      createdAt: new Date().toISOString(),
      dueAt: dueAt || null,
      category: category || 'doctor',
      source: source || 'manual',
      status: status || undefined,
      agentNote: agentNote || null,
    };
    tasks.push(task);
    await saveTasks(vpsJwt, tasks);
    res.json({ task });
  } catch (err) {
    console.error('Admin agent tasks POST error:', err);
    res.status(500).json({ error: 'Failed to create task.' });
  }
});

// PATCH /api/admin-agent/tasks/:id
router.patch('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { done, title, status, agentNote, completedAt, patientFolderId, patientName } = req.body as {
      done?: boolean;
      title?: string;
      status?: 'running' | 'complete' | 'failed';
      agentNote?: string;
      completedAt?: string;
      patientFolderId?: string;
      patientName?: string;
    };
    const vpsJwt = await resolveVpsJwt(req);
    const tasks = await loadTasks(vpsJwt);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) { res.status(404).json({ error: 'Task not found.' }); return; }
    if (done !== undefined) {
      tasks[idx].done = done;
      if (done && !tasks[idx].completedAt) tasks[idx].completedAt = new Date().toISOString();
    }
    if (title?.trim()) tasks[idx].title = title.trim();
    if (status !== undefined) tasks[idx].status = status;
    if (agentNote !== undefined) tasks[idx].agentNote = agentNote;
    if (completedAt !== undefined) tasks[idx].completedAt = completedAt;
    if (patientFolderId !== undefined) tasks[idx].patientFolderId = patientFolderId;
    if (patientName !== undefined) tasks[idx].patientName = patientName;
    await saveTasks(vpsJwt, tasks);
    res.json({ task: tasks[idx] });
  } catch (err) {
    console.error('Admin agent tasks PATCH error:', err);
    res.status(500).json({ error: 'Failed to update task.' });
  }
});

// DELETE /api/admin-agent/tasks/:id
router.delete('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const vpsJwt = await resolveVpsJwt(req);
    const tasks = (await loadTasks(vpsJwt)).filter(t => t.id !== id);
    await saveTasks(vpsJwt, tasks);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin agent tasks DELETE error:', err);
    res.status(500).json({ error: 'Failed to delete task.' });
  }
});

// POST /api/admin-agent/tasks/:id/chat
// Send a message on a specific task's conversation thread. Calls VPS agent with task context.
router.post('/tasks/:id/chat', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { message } = req.body as { message?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required.' });
      return;
    }
    const vpsJwt = await resolveVpsJwt(req);
    const tasks = await loadTasks(vpsJwt);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) { res.status(404).json({ error: 'Task not found.' }); return; }
    const task = tasks[idx];
    const conversation = task.conversation ?? [];

    // Call VPS /agent/card-chat — a dedicated endpoint that loads the patient summary and
    // current document content from Drive and builds a focused system prompt. Context is
    // injected at the system level, not as a fake assistant history turn.
    const fileId = task.driveFileId || (task.actionUrl ? extractDriveFileId(task.actionUrl) : null);

    const vpsRes = await fetch(`${config.vpsBaseUrl}/agent/card-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vpsJwt}` },
      body: JSON.stringify({
        message: message.trim(),
        history: conversation,
        file_id: fileId,
        patient_folder_id: task.patientFolderId ?? null,
        patient_name: task.patientName ?? null,
        document_type: task.documentType ?? null,
        task_title: task.title,
        task_type: task.taskType ?? null,
      }),
    });

    let rawResponse = 'I couldn\'t process that. Please try again.';
    if (vpsRes.ok) {
      const text = await collectVpsStream(vpsRes);
      if (text) rawResponse = text;
    }

    // Detect reprocess signal — present only when unidentified_bundle branch found the patient
    const REPROCESS_RE = /\[REPROCESS:([^:\]]+):([^\]]+)\]/;
    const reprocessMatch = rawResponse.match(REPROCESS_RE);
    if (reprocessMatch) {
      const reprocessFolderId    = reprocessMatch[1];
      const reprocessPatientName = decodeURIComponent(reprocessMatch[2]);
      const agentResponse = rawResponse.replace(REPROCESS_RE, '').trim();
      const updatedConversation: ConversationMessage[] = [
        ...conversation,
        { role: 'user',      content: message.trim() },
        { role: 'assistant', content: agentResponse },
      ];
      tasks[idx] = { ...task, conversation: updatedConversation };
      await saveTasks(vpsJwt, tasks);
      res.json({ response: agentResponse, readyToAmend: false, reprocessing: true, reprocessFolderId, reprocessPatientName, task: tasks[idx] });
      return;
    }

    // Detect and strip [READY_TO_AMEND] token — it's a system signal, not conversation content
    const readyToAmend = rawResponse.includes('[READY_TO_AMEND]');
    const agentResponse = rawResponse.replace(/\[READY_TO_AMEND\]/g, '').replace(/\n{3,}/g, '\n\n').trim();

    const updatedConversation: ConversationMessage[] = [
      ...conversation,
      { role: 'user', content: message.trim() },
      { role: 'assistant', content: agentResponse },
    ];

    tasks[idx] = { ...task, conversation: updatedConversation };
    await saveTasks(vpsJwt, tasks);
    res.json({ response: agentResponse, readyToAmend, task: tasks[idx] });
  } catch (err) {
    console.error('Task chat error:', err);
    res.status(500).json({ error: 'Task chat failed.' });
  }
});

// POST /api/admin-agent/tasks/:id/amend
// Calls VPS /agent/amend which reads the Drive file, regenerates it with Gemini using the full
// conversation context, and overwrites the file in-place. No LLM chat turn is involved.
router.post('/tasks/:id/amend', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const vpsJwt = await resolveVpsJwt(req);
    const tasks = await loadTasks(vpsJwt);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) { res.status(404).json({ error: 'Task not found.' }); return; }
    const task = tasks[idx];

    const fileId = task.driveFileId || (task.actionUrl ? extractDriveFileId(task.actionUrl) : null);
    if (!fileId) {
      res.status(400).json({ error: 'No Drive file linked to this task.' });
      return;
    }

    const vpsRes = await fetch(`${config.vpsBaseUrl}/agent/amend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vpsJwt}` },
      body: JSON.stringify({
        file_id: fileId,
        conversation: task.conversation ?? [],
        task_title: task.title,
        document_type: task.documentType ?? null,
        patient_name: task.patientName ?? null,
      }),
    });

    if (!vpsRes.ok) {
      const errText = await vpsRes.text().catch(() => '');
      console.error(`[Amend] VPS /agent/amend ${vpsRes.status}: ${errText}`);
      res.status(502).json({ error: 'Document amendment failed. Please try again.' });
      return;
    }

    const data = await vpsRes.json() as { success: boolean; confirmation: string };
    const confirmation = data.confirmation || 'Document updated ✓ — open to verify.';

    const updatedConversation: ConversationMessage[] = [
      ...(task.conversation ?? []),
      { role: 'assistant', content: confirmation },
    ];

    tasks[idx] = { ...task, conversation: updatedConversation };
    await saveTasks(vpsJwt, tasks);
    res.json({ response: confirmation, task: tasks[idx] });
  } catch (err) {
    console.error('Task amend error:', err);
    res.status(500).json({ error: 'Amendment failed.' });
  }
});

// POST /api/admin-agent/tasks/:id/reprocess
// Re-runs note generation for an unidentified bundle once patient identity is known.
// Proxies VPS SSE stream to the browser so the 30s H12 timeout is avoided.
router.post('/tasks/:id/reprocess', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { patient_folder_id, patient_name } = req.body as { patient_folder_id?: string; patient_name?: string };
    if (!patient_folder_id || !patient_name) {
      res.status(400).json({ error: 'patient_folder_id and patient_name are required.' });
      return;
    }
    const vpsJwt = await resolveVpsJwt(req);
    const tasks = await loadTasks(vpsJwt);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) { res.status(404).json({ error: 'Task not found.' }); return; }
    const task = tasks[idx];
    if (!task.caseId) { res.status(400).json({ error: 'Task has no caseId — cannot reprocess.' }); return; }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    const vpsRes = await fetch(`${config.vpsBaseUrl}/agent/reprocess-case`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vpsJwt}` },
      body: JSON.stringify({
        case_id: task.caseId,
        patient_folder_id,
        patient_name,
        task_id: id,
      }),
    });

    if (!vpsRes.ok) {
      res.write(`data: ${JSON.stringify('[Error: VPS reprocess failed]')}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const reader = vpsRes.body?.getReader();
    if (!reader) {
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    let rpBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        rpBuffer += decoder.decode(value, { stream: true });
        const lines = rpBuffer.split('\n');
        rpBuffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data) as unknown;
            if (parsed && typeof parsed === 'object') {
              const obj = parsed as { status?: string; message?: string; task?: AgentTask };
              if (obj.status === 'done' && obj.task) {
                tasks[idx] = obj.task;
                await saveTasks(vpsJwt, tasks);
                res.write(`data: ${JSON.stringify({ status: 'done', task: obj.task })}\n\n`);
              } else if (obj.status) {
                res.write(`data: ${JSON.stringify({ status: obj.status, message: obj.message ?? '' })}\n\n`);
              }
            } else if (typeof parsed === 'string' && parsed.startsWith('[Error:')) {
              res.write(`data: ${JSON.stringify(parsed)}\n\n`);
            }
          } catch { /* skip malformed */ }
        }
      }
    } finally {
      reader.releaseLock();
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Task reprocess error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Reprocess failed.' });
    } else {
      res.write(`data: ${JSON.stringify('[Error: reprocess failed]')}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

// POST /api/admin-agent/tasks/:id/approve
// Files the document to the patient's Letters subfolder, creates a To Do reminder, marks task complete.
router.post('/tasks/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const token = req.session.accessToken!;
    const vpsJwt = await resolveVpsJwt(req);
    const tasks = await loadTasks(vpsJwt);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) { res.status(404).json({ error: 'Task not found.' }); return; }
    const task = tasks[idx];

    // If patient folder is unknown, add a guiding question to the conversation and return early.
    // The doctor answers via the card conversation, then taps Approve again once the folder is resolved.
    if (!task.patientFolderId) {
      const agentQuestion = 'To file this document, I need to link it to a patient folder. Which patient is this for?';
      const updatedConversation: ConversationMessage[] = [
        ...(task.conversation ?? []),
        { role: 'assistant', content: agentQuestion },
      ];
      tasks[idx] = { ...task, conversation: updatedConversation };
      await saveTasks(vpsJwt, tasks);
      res.json({ needsPatient: true, task: tasks[idx] });
      return;
    }

    // Call VPS to generate docx, file to Letters/, and trash the markdown draft.
    // VPS reads the markdown, applies letterhead via docx_generator, uploads the polished
    // docx to Halo/Patients/[folder]/Letters/, and returns the new document URL.
    const fileId = task.driveFileId || (task.actionUrl ? extractDriveFileId(task.actionUrl) : null);
    let filed = false;
    let docxUrl: string | null = null;
    let filedTo: string | null = task.targetSubfolder ?? null;

    if (fileId) {
      try {
        const vpsApproveRes = await fetch(`${config.vpsBaseUrl}/agent/approve-document`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vpsJwt}` },
          body: JSON.stringify({
            file_id: fileId,
            patient_folder_id: task.patientFolderId,
            document_type: task.documentType ?? null,
            patient_name: task.patientName ?? null,
            review_format: task.reviewFormat ?? null,
            target_subfolder: task.targetSubfolder ?? null,
            task_id: task.id,
            task_type: task.taskType ?? null,
          }),
        });
        if (vpsApproveRes.ok) {
          const data = await vpsApproveRes.json() as {
            success: boolean; docx_url: string; filed?: boolean; filedTo?: string | null;
          };
          docxUrl = data.docx_url;
          filed = true;
          if (data.filedTo != null) filedTo = data.filedTo;
        } else {
          const errText = await vpsApproveRes.text().catch(() => '');
          console.error(`[Approve] VPS /agent/approve-document ${vpsApproveRes.status}: ${errText}`);
        }
      } catch (err) {
        console.error(`[Approve] VPS approve-document call failed:`, err);
      }
    }

    tasks[idx] = { ...task, done: true, completedAt: new Date().toISOString(), status: 'complete' };

    // Only create a "Send" reminder for referral requests — all other types file silently
    if (task.documentType === 'REFERRAL_REQUEST') {
      const reminderTitle = ['Send referral', task.patientName ? `— ${task.patientName}` : '']
        .filter(Boolean).join(' ').trim();
      const reminder: AgentTask = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        title: reminderTitle,
        done: false,
        createdAt: new Date().toISOString(),
        category: 'doctor',
        source: 'approve_flow',
        agentNote: filed
          ? `DOCX filed to ${task.targetSubfolder || 'Letters'} folder. Open to review before sending.`
          : fileId
            ? 'DOCX generation failed — check Review folder in Drive.'
            : 'No Drive file found — check manually.',
        actionUrl: docxUrl || task.actionUrl || null,
        patientName: task.patientName || null,
        patientFolderId: task.patientFolderId,
      };
      tasks.push(reminder);
      await saveTasks(vpsJwt, tasks);
      res.json({ success: true, filed, filedTo, reminder, task: tasks[idx] });
    } else {
      await saveTasks(vpsJwt, tasks);
      res.json({ success: true, filed, filedTo, task: tasks[idx] });
    }
  } catch (err) {
    console.error('Task approve error:', err);
    res.status(500).json({ error: 'Failed to approve task.' });
  }
});

// POST /api/admin-agent/tasks/:id/discard
// Trashes the Drive file, labels the Gmail thread (if email-sourced), removes the task.
router.post('/tasks/:id/discard', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const token = req.session.accessToken!;
    const vpsJwt = await resolveVpsJwt(req);
    const tasks = await loadTasks(vpsJwt);
    const idx = tasks.findIndex(t => t.id === id);
    if (idx === -1) { res.status(404).json({ error: 'Task not found.' }); return; }
    const task = tasks[idx];

    // Trash the Drive file
    const fileId = task.driveFileId || (task.actionUrl ? extractDriveFileId(task.actionUrl) : null);
    if (fileId) {
      await trashDriveFile(token, fileId).catch(err =>
        console.error(`[Discard] Drive trash failed for task ${id}:`, err)
      );
    }

    // Label the Gmail thread so the email monitor skips it on future runs
    if (task.threadId) {
      await labelGmailThread(token, task.threadId, 'Halo-Discarded').catch(err =>
        console.error(`[Discard] Gmail label failed for thread ${task.threadId}:`, err)
      );
    }

    const updatedTasks = tasks.filter(t => t.id !== id);
    await saveTasks(vpsJwt, updatedTasks);
    res.json({ success: true });
  } catch (err) {
    console.error('Task discard error:', err);
    res.status(500).json({ error: 'Failed to discard task.' });
  }
});

// --- Connections ---

// GET /api/admin-agent/connections
router.get('/connections', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;

    let gmailConnected = false;
    try {
      const gmailRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/profile',
        { headers: { Authorization: `Bearer ${token}` } }
      );
      gmailConnected = gmailRes.ok;
    } catch { /* not connected */ }

    let onedriveConnected = false;
    try {
      const vpsJwt = await resolveVpsJwt(req);
      const status = await getOnedriveStatus(vpsJwt);
      onedriveConnected = status.connected;
    } catch { /* VPS not configured or unreachable */ }

    res.json({
      gmail: { connected: gmailConnected },
      onedrive: { connected: onedriveConnected },
      whatsapp: { connected: false },
    });
  } catch (err) {
    console.error('Admin agent connections error:', err);
    res.status(500).json({ error: 'Failed to check connections.' });
  }
});

// --- VPS Provisioning ---

router.post('/vps/provision', async (req: Request, res: Response) => {
  try {
    const userEmail = req.session.userEmail!;
    if (!userEmail) { res.status(400).json({ error: 'No user email in session.' }); return; }
    const vpsJwt = await resolveVpsJwt(req);
    if (req.session.refreshToken) {
      registerSession(userEmail, req.session.refreshToken);
    }
    res.json({ provisioned: true, vpsJwt });
  } catch (err) {
    console.error('VPS provision error:', err);
    res.status(500).json({ error: 'Failed to provision VPS account.' });
  }
});

// --- Billing cap (legacy — kept for AdminAgentOnboarding) ---

router.get('/vps/billing-cap', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const cap = await getBillingCap(vpsJwt);
    res.json({ cap: cap ?? 500 });
  } catch (err) {
    console.error('Billing cap GET error:', err);
    res.status(500).json({ error: 'Failed to get billing cap.' });
  }
});

router.put('/vps/billing-cap', async (req: Request, res: Response) => {
  try {
    const { cap } = req.body as { cap?: number };
    if (typeof cap !== 'number' || cap < 100 || cap > 5000) {
      res.status(400).json({ error: 'cap must be a number between 100 and 5000.' });
      return;
    }
    const vpsJwt = await resolveVpsJwt(req);
    await setBillingCap(vpsJwt, cap);
    res.json({ success: true, cap });
  } catch (err) {
    console.error('Billing cap PUT error:', err);
    res.status(500).json({ error: 'Failed to set billing cap.' });
  }
});

router.post('/vps/setup-done', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    await markSetupDone(vpsJwt);
    res.json({ success: true });
  } catch (err) {
    console.error('Setup done error:', err);
    res.status(500).json({ error: 'Failed to mark setup done.' });
  }
});

// --- Tier ---

router.get('/tier', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const tier = await getTier(vpsJwt);
    res.json({ tier });
  } catch (err) {
    console.error('Tier GET error:', err);
    res.status(500).json({ error: 'Failed to get tier.' });
  }
});

router.put('/tier', async (req: Request, res: Response) => {
  try {
    const { tier } = req.body as { tier?: number };
    if (!tier || ![1, 2, 3].includes(tier)) {
      res.status(400).json({ error: 'tier must be 1, 2, or 3.' });
      return;
    }
    const vpsJwt = await resolveVpsJwt(req);
    await setTier(vpsJwt, tier);
    res.json({ success: true, tier });
  } catch (err) {
    console.error('Tier PUT error:', err);
    res.status(500).json({ error: 'Failed to set tier.' });
  }
});

// --- Usage ---

router.get('/usage', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const tierId = await getTier(vpsJwt);
    const usage = await getTokenUsage(vpsJwt, tierId);
    res.json({ ...usage, tier: tierId });
  } catch (err) {
    console.error('Usage GET error:', err);
    res.status(500).json({ error: 'Failed to get usage.' });
  }
});

// --- Automations ---

router.get('/automations', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const automations = await getAutomations(vpsJwt);
    res.json({ automations });
  } catch (err) {
    console.error('Automations GET error:', err);
    res.status(500).json({ error: 'Failed to load automations.' });
  }
});

router.post('/automations', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<Automation>;
    if (!body.name?.trim() || !body.description?.trim()) {
      res.status(400).json({ error: 'name and description are required.' });
      return;
    }
    const vpsJwt = await resolveVpsJwt(req);
    const automations = await getAutomations(vpsJwt);

    const resolvedId =
      body.type === 'preset' && body.id
        ? body.id
        : `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

    if (automations.some(a => a.id === resolvedId)) {
      res.status(409).json({ error: 'An automation with this ID already exists.' });
      return;
    }

    const newAutomation: Automation = {
      id: resolvedId,
      type: body.type || 'custom',
      name: body.name.trim(),
      description: body.description.trim(),
      enabled: body.enabled ?? true,
      frequency: body.frequency,
      trigger: body.trigger,
      condition: body.condition,
      action: body.action,
      lastRunAt: null,
      created_at: new Date().toISOString(),
    };

    automations.push(newAutomation);
    await saveAutomations(vpsJwt, automations);
    res.json({ automation: newAutomation });
  } catch (err) {
    console.error('Automations POST error:', err);
    res.status(500).json({ error: 'Failed to create automation.' });
  }
});

// POST /api/admin-agent/automations/:id/run  (manual trigger)
router.post('/automations/:id/run', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const vpsJwt = await resolveVpsJwt(req);

    fetch(`${config.vpsBaseUrl}/agent/automation/run/${encodeURIComponent(id as string)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${vpsJwt}` },
    }).catch(err => console.error(`[AutomationRun] background call failed for ${id}:`, err));

    res.json({ result: 'running', note: 'Automation started — check Tasks tab in 30–60 seconds.' });
  } catch (err) {
    console.error('Automation manual run error:', err);
    res.status(500).json({ result: 'failed', note: String(err) });
  }
});

router.patch('/automations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const patch = req.body as Partial<Automation>;
    const vpsJwt = await resolveVpsJwt(req);
    const automations = await getAutomations(vpsJwt);
    const idx = automations.findIndex(a => a.id === id);
    if (idx === -1) { res.status(404).json({ error: 'Automation not found.' }); return; }
    automations[idx] = { ...automations[idx], ...patch, id: id as string };
    await saveAutomations(vpsJwt, automations);
    res.json({ automation: automations[idx] });
  } catch (err) {
    console.error('Automations PATCH error:', err);
    res.status(500).json({ error: 'Failed to update automation.' });
  }
});

router.delete('/automations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const vpsJwt = await resolveVpsJwt(req);
    let automations = await getAutomations(vpsJwt);
    automations = automations.filter(a => a.id !== id);
    await saveAutomations(vpsJwt, automations);
    res.json({ success: true });
  } catch (err) {
    console.error('Automations DELETE error:', err);
    res.status(500).json({ error: 'Failed to delete automation.' });
  }
});

// --- OneDrive ---

router.get('/onedrive/auth-url', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const authUrl = getOnedriveAuthUrl(vpsJwt);
    res.json({ authUrl });
  } catch (err) {
    console.error('OneDrive auth URL error:', err);
    res.status(500).json({ error: 'Failed to get OneDrive auth URL.' });
  }
});

router.get('/onedrive/status', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const status = await getOnedriveStatus(vpsJwt);
    res.json(status);
  } catch (err) {
    console.error('OneDrive status error:', err);
    res.json({ connected: false });
  }
});

router.post('/onedrive/setup', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    await triggerOnedriveSetup(vpsJwt);
    res.json({ success: true });
  } catch (err) {
    console.error('OneDrive setup error:', err);
    res.status(500).json({ error: 'Failed to trigger OneDrive folder setup.' });
  }
});

// --- Google Drive subfolder setup (Halo folder structure) ---

const PATIENT_SUBFOLDER_NAMES = ['Clerking Sheets', 'Letters', 'Radiology', 'Labs', 'Scanned Documents', 'Subspecialist Referral'];

router.post('/drive-folders/setup', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const rootId = await getHaloRootFolder(token);
    const folderIds: Record<string, string> = {};

    await Promise.all(
      DRIVE_SUBFOLDER_NAMES.map(async (name) => {
        const q = encodeURIComponent(
          `'${rootId}' in parents and name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false`
        );
        const existing = await driveRequest(token, `/files?q=${q}&fields=files(id)`) as { files?: Array<{ id: string }> };
        if (existing.files?.[0]?.id) {
          folderIds[name] = existing.files[0].id;
          return;
        }
        const res2 = await fetch(`${config.driveApi}/files`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [rootId] }),
        });
        const created = (await res2.json()) as { id: string };
        folderIds[name] = created.id;
      })
    );

    const vpsJwt = await resolveVpsJwt(req);
    await setVpsConfig(vpsJwt, 'agent_folders', JSON.stringify(folderIds));
    res.json({ success: true, folderIds });
  } catch (err) {
    console.error('Drive folders setup error:', err);
    res.status(500).json({ error: 'Failed to create Drive folders.' });
  }
});

// POST /api/admin-agent/patient-subfolders/:folderId
router.post('/patient-subfolders/:folderId', async (req: Request, res: Response) => {
  try {
    const { folderId } = req.params;
    const token = req.session.accessToken!;
    const subfolderIds: Record<string, string> = {};

    await Promise.all(
      PATIENT_SUBFOLDER_NAMES.map(async (name) => {
        const q = encodeURIComponent(
          `'${folderId}' in parents and name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false`
        );
        const existing = await driveRequest(token, `/files?q=${q}&fields=files(id)`) as { files?: Array<{ id: string }> };
        if (existing.files?.[0]?.id) {
          subfolderIds[name] = existing.files[0].id;
          return;
        }
        const r = await fetch(`${config.driveApi}/files`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [folderId] }),
        });
        const created = (await r.json()) as { id: string };
        subfolderIds[name] = created.id;
      })
    );

    const q = encodeURIComponent(`'${folderId}' in parents and name='_Summary.md' and trashed=false`);
    const existingSummary = await driveRequest(token, `/files?q=${q}&fields=files(id)`) as { files?: Array<{ id: string }> };
    if (!existingSummary.files?.[0]?.id) {
      const boundary = 'halo_summary_b';
      const meta = JSON.stringify({ name: '_Summary.md', parents: [folderId], mimeType: 'text/markdown' });
      const mp = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
        `--${boundary}\r\nContent-Type: text/markdown\r\n\r\n# Patient Summary\n\n_No entries yet._\r\n` +
        `--${boundary}--`
      );
      await fetch(`${config.uploadApi}/files?uploadType=multipart`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: mp,
      });
    }

    res.json({ success: true, subfolderIds });
  } catch (err) {
    console.error('Patient subfolders error:', err);
    res.status(500).json({ error: 'Failed to create patient subfolders.' });
  }
});

// --- Morning Brief ---

router.get('/morning-brief', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const [lastSeenRaw, tasks] = await Promise.all([
      getVpsConfig(vpsJwt, 'agent_last_seen'),
      loadTasks(vpsJwt),
    ]);

    let lastSeenAt: string | null = null;
    if (lastSeenRaw) {
      try { lastSeenAt = (JSON.parse(lastSeenRaw) as { lastSeenAt: string }).lastSeenAt; } catch { /* ignore */ }
    }

    const newlyDone = tasks.filter(t => {
      if (!t.completedAt) return false;
      if (!lastSeenAt) return t.done;
      return new Date(t.completedAt).getTime() > new Date(lastSeenAt).getTime();
    });

    const agentTasks = newlyDone.filter(t => t.category === 'agent');
    const doctorTasks = tasks.filter(t => t.category === 'doctor' && !t.done);

    if (agentTasks.length === 0 && doctorTasks.length === 0) {
      res.json({ brief: null, hasNew: false });
      return;
    }

    const lines: string[] = [];
    if (agentTasks.length > 0) {
      lines.push(`**${agentTasks.length} task${agentTasks.length > 1 ? 's' : ''} completed** while you were away:`);
      agentTasks.slice(0, 5).forEach(t => {
        const icon = t.status === 'failed' ? '✗' : '✓';
        lines.push(`${icon} ${t.title}${t.agentNote ? ` — ${t.agentNote}` : ''}`);
      });
    }
    if (doctorTasks.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push(`**${doctorTasks.length} item${doctorTasks.length > 1 ? 's' : ''} need${doctorTasks.length === 1 ? 's' : ''} your attention:**`);
      doctorTasks.slice(0, 3).forEach(t => lines.push(`• ${t.title}`));
    }

    res.json({ brief: lines.join('\n'), hasNew: true, agentCount: agentTasks.length, doctorCount: doctorTasks.length });
  } catch (err) {
    console.error('Morning brief error:', err);
    res.json({ brief: null, hasNew: false });
  }
});

router.post('/last-seen', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    await setVpsConfig(vpsJwt, 'agent_last_seen', JSON.stringify({ lastSeenAt: new Date().toISOString() }));
    res.json({ success: true });
  } catch (err) {
    console.error('Last seen error:', err);
    res.status(500).json({ error: 'Failed to update last seen.' });
  }
});

// --- Patient Search (proxied to VPS) ---

router.get('/patients/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    const vpsJwt = await resolveVpsJwt(req);
    const url = `${config.vpsBaseUrl}/agent/patients${q ? `?q=${encodeURIComponent(q)}` : ''}`;
    const vpsRes = await fetch(url, { headers: { Authorization: `Bearer ${vpsJwt}` } });
    if (!vpsRes.ok) {
      res.status(502).json({ error: 'Failed to search patients.' });
      return;
    }
    const data = (await vpsRes.json()) as { patients: Array<{ id: string; name: string }> };
    res.json({ patients: data.patients });
  } catch (err) {
    console.error('Patient search error:', err);
    res.status(500).json({ error: 'Failed to search patients.' });
  }
});

// --- Letterhead ---

router.get('/letterhead', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const vpsRes = await fetch(`${config.vpsBaseUrl}/agent/letterhead/status`, {
      headers: { Authorization: `Bearer ${vpsJwt}` },
    });
    if (!vpsRes.ok) { res.status(502).json({ error: 'Failed to get letterhead status.' }); return; }
    res.json(await vpsRes.json());
  } catch (err) {
    console.error('Letterhead status error:', err);
    res.status(500).json({ error: 'Failed to get letterhead status.' });
  }
});

router.post('/letterhead', express.raw({ type: '*/*', limit: '15mb' }), async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const vpsRes = await fetch(`${config.vpsBaseUrl}/agent/letterhead/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vpsJwt}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      body: req.body as Buffer,
    });
    if (!vpsRes.ok) { res.status(502).json({ error: 'Failed to upload letterhead.' }); return; }
    res.json(await vpsRes.json());
  } catch (err) {
    console.error('Letterhead upload error:', err);
    res.status(500).json({ error: 'Failed to upload letterhead.' });
  }
});

router.delete('/letterhead', async (req: Request, res: Response) => {
  try {
    const vpsJwt = await resolveVpsJwt(req);
    const vpsRes = await fetch(`${config.vpsBaseUrl}/agent/letterhead`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${vpsJwt}` },
    });
    if (!vpsRes.ok) { res.status(502).json({ error: 'Failed to delete letterhead.' }); return; }
    res.json(await vpsRes.json());
  } catch (err) {
    console.error('Letterhead delete error:', err);
    res.status(500).json({ error: 'Failed to delete letterhead.' });
  }
});

// --- Chat (SSE streaming) ---

interface ChatAttachment {
  name: string;
  mimeType: string;
  base64: string;
}

router.post('/chat', async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body as {
      message?: string;
      history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required.' });
      return;
    }

    const userEmail = req.session.userEmail || 'the doctor';

    if (req.session.refreshToken) {
      registerSession(userEmail, req.session.refreshToken);
    }

    const vpsJwt = await resolveVpsJwt(req);

    setVpsConfig(vpsJwt, 'automation_session', JSON.stringify({
      email: userEmail,
      refreshToken: req.session.refreshToken,
      lastSeen: new Date().toISOString(),
    })).catch(() => {});

    const vpsRes = await fetch(`${config.vpsBaseUrl}/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${vpsJwt}`,
      },
      body: JSON.stringify({ message, history }),
    });

    if (!vpsRes.ok) {
      const errText = await vpsRes.text().catch(() => '');
      console.error('VPS chat error:', vpsRes.status, errText);
      res.status(502).json({ error: 'Agent unavailable. Please try again.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const reader = vpsRes.body?.getReader();
    if (!reader) {
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }

    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
  } catch (err) {
    console.error('Admin agent chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Chat failed. Please try again.' });
    } else {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

// --- Gmail ---

router.get('/gmail/threads', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const maxResults = Math.min(Number(req.query.maxResults) || 10, 20);

    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=${maxResults}&labelIds=INBOX`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) {
      res.status(listRes.status).json({ error: 'Gmail not accessible.' });
      return;
    }
    const listData = (await listRes.json()) as { threads?: Array<{ id: string; snippet: string }> };

    const threads = await Promise.all(
      (listData.threads || []).map(async (t) => {
        try {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!msgRes.ok) return { id: t.id, subject: '(unknown)', from: '', date: '', snippet: t.snippet };
          const msgData = (await msgRes.json()) as {
            messages?: Array<{ payload?: { headers?: Array<{ name: string; value: string }> } }>;
            snippet?: string;
          };
          const firstMsg = msgData.messages?.[0];
          const headers = firstMsg?.payload?.headers || [];
          const header = (n: string) => headers.find(h => h.name === n)?.value || '';
          return {
            id: t.id,
            subject: header('Subject') || '(no subject)',
            from: header('From'),
            date: header('Date'),
            snippet: msgData.snippet || t.snippet,
          };
        } catch {
          return { id: t.id, subject: '(unknown)', from: '', date: '', snippet: t.snippet };
        }
      })
    );

    res.json({ threads });
  } catch (err) {
    console.error('Admin agent gmail threads error:', err);
    res.status(500).json({ error: 'Failed to fetch Gmail threads.' });
  }
});

router.post('/gmail/draft', async (req: Request, res: Response) => {
  try {
    const { to, subject, body } = req.body as { to?: string; subject?: string; body?: string };
    if (!to || !subject || !body) {
      res.status(400).json({ error: 'to, subject, and body are required.' });
      return;
    }
    const token = req.session.accessToken!;
    const fromEmail = req.session.userEmail || '';

    const rawEmail = [
      `From: ${fromEmail}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
    ].join('\r\n');

    const encoded = Buffer.from(rawEmail).toString('base64url');

    const draftRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { raw: encoded } }),
    });

    if (!draftRes.ok) {
      const err = await draftRes.json();
      res.status(draftRes.status).json({ error: (err as { error?: { message?: string } }).error?.message || 'Draft creation failed.' });
      return;
    }

    const draft = (await draftRes.json()) as { id: string };
    res.json({ draftId: draft.id });
  } catch (err) {
    console.error('Admin agent gmail draft error:', err);
    res.status(500).json({ error: 'Failed to create draft.' });
  }
});

export default router;
