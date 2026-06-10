import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { driveRequest, getHaloRootFolder, getOrCreatePracticeAdminPdfDocumentsFolder } from '../services/drive';
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
} from '../services/vpsApi';
import type { Automation } from '../agent/capabilities';
import { registerSession } from '../jobs/automationRunner';

const router = Router();
router.use(requireAuth);


const DRIVE_SUBFOLDER_NAMES = ['Black Hole', 'Patients', 'Review', 'Billing', 'Archive'] as const;
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// --- Drive helpers ---

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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    const existing = await getVpsConfig(vpsJwt, 'agent_memory');
    if (existing) {
      res.json({ markdown: existing });
      return;
    }
    // No memory yet — seed from user settings
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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    await setVpsConfig(vpsJwt, 'agent_memory', markdown);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin agent memory PUT error:', err);
    res.status(500).json({ error: 'Failed to save agent memory.' });
  }
});

// --- Tasks ---

interface AgentTask {
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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    res.json({ tasks: await loadTasks(vpsJwt) });
  } catch (err) {
    console.error('Admin agent tasks GET error:', err);
    res.status(500).json({ error: 'Failed to load tasks.' });
  }
});

// POST /api/admin-agent/tasks
router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const { title, dueAt, category, status, agentNote } = req.body as {
      title?: string;
      dueAt?: string;
      category?: 'agent' | 'doctor';
      status?: 'running' | 'complete' | 'failed';
      agentNote?: string;
    };
    if (!title?.trim()) {
      res.status(400).json({ error: 'title is required.' });
      return;
    }
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    const tasks = await loadTasks(vpsJwt);
    const task: AgentTask = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      done: false,
      createdAt: new Date().toISOString(),
      dueAt: dueAt || null,
      category: category || 'doctor',
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
    const { done, title, status, agentNote, completedAt } = req.body as {
      done?: boolean;
      title?: string;
      status?: 'running' | 'complete' | 'failed';
      agentNote?: string;
      completedAt?: string;
    };
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    const tasks = (await loadTasks(vpsJwt)).filter(t => t.id !== id);
    await saveTasks(vpsJwt, tasks);
    res.json({ success: true });
  } catch (err) {
    console.error('Admin agent tasks DELETE error:', err);
    res.status(500).json({ error: 'Failed to delete task.' });
  }
});

// --- Connections ---

// GET /api/admin-agent/connections
router.get('/connections', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail || '';

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
      const vpsJwt = await getVpsJwt(token, userEmail);
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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    if (!userEmail) { res.status(400).json({ error: 'No user email in session.' }); return; }
    const vpsJwt = await getVpsJwt(token, userEmail);
    // Register session for automation runner
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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    await setBillingCap(vpsJwt, cap);
    res.json({ success: true, cap });
  } catch (err) {
    console.error('Billing cap PUT error:', err);
    res.status(500).json({ error: 'Failed to set billing cap.' });
  }
});

router.post('/vps/setup-done', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    await markSetupDone(vpsJwt);
    res.json({ success: true });
  } catch (err) {
    console.error('Setup done error:', err);
    res.status(500).json({ error: 'Failed to mark setup done.' });
  }
});

// --- Tier ---

// GET /api/admin-agent/tier
router.get('/tier', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    const tier = await getTier(vpsJwt);
    res.json({ tier });
  } catch (err) {
    console.error('Tier GET error:', err);
    res.status(500).json({ error: 'Failed to get tier.' });
  }
});

// PUT /api/admin-agent/tier
router.put('/tier', async (req: Request, res: Response) => {
  try {
    const { tier } = req.body as { tier?: number };
    if (!tier || ![1, 2, 3].includes(tier)) {
      res.status(400).json({ error: 'tier must be 1, 2, or 3.' });
      return;
    }
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    await setTier(vpsJwt, tier);
    res.json({ success: true, tier });
  } catch (err) {
    console.error('Tier PUT error:', err);
    res.status(500).json({ error: 'Failed to set tier.' });
  }
});

// --- Usage ---

// GET /api/admin-agent/usage
router.get('/usage', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    const tierId = await getTier(vpsJwt);
    const usage = await getTokenUsage(vpsJwt, tierId);
    res.json({ ...usage, tier: tierId });
  } catch (err) {
    console.error('Usage GET error:', err);
    res.status(500).json({ error: 'Failed to get usage.' });
  }
});

// --- Automations ---

// GET /api/admin-agent/automations
router.get('/automations', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    const automations = await getAutomations(vpsJwt);
    res.json({ automations });
  } catch (err) {
    console.error('Automations GET error:', err);
    res.status(500).json({ error: 'Failed to load automations.' });
  }
});

// POST /api/admin-agent/automations
router.post('/automations', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<Automation>;
    if (!body.name?.trim() || !body.description?.trim()) {
      res.status(400).json({ error: 'name and description are required.' });
      return;
    }
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    const automations = await getAutomations(vpsJwt);

    const newAutomation: Automation = {
      id: `auto-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
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

// PATCH /api/admin-agent/automations/:id
router.patch('/automations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const patch = req.body as Partial<Automation>;
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
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

// DELETE /api/admin-agent/automations/:id
router.delete('/automations/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    const authUrl = getOnedriveAuthUrl(vpsJwt);
    res.json({ authUrl });
  } catch (err) {
    console.error('OneDrive auth URL error:', err);
    res.status(500).json({ error: 'Failed to get OneDrive auth URL.' });
  }
});

router.get('/onedrive/status', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
    const status = await getOnedriveStatus(vpsJwt);
    res.json(status);
  } catch (err) {
    console.error('OneDrive status error:', err);
    res.json({ connected: false });
  }
});

router.post('/onedrive/setup', async (req: Request, res: Response) => {
  try {
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
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
    const userEmail = req.session.userEmail!;
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

    folderIds['Practice Admin/PDF Documents'] = await getOrCreatePracticeAdminPdfDocumentsFolder(token);

    const vpsJwt = await getVpsJwt(token, userEmail);
    await setVpsConfig(vpsJwt, 'agent_folders', JSON.stringify(folderIds));

    res.json({ success: true, folderIds });
  } catch (err) {
    console.error('Drive folders setup error:', err);
    res.status(500).json({ error: 'Failed to create Drive folders.' });
  }
});

// POST /api/admin-agent/patient-subfolders/:folderId — create standard subfolders for a patient
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

    // Create _Summary.md if it doesn't exist
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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);

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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail!;
    const vpsJwt = await getVpsJwt(token, userEmail);
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
    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail || '';
    let vpsJwt = req.session.vpsJwt;
    if (!vpsJwt) {
      vpsJwt = await getVpsJwt(token, userEmail);
    }
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

    const token = req.session.accessToken!;
    const userEmail = req.session.userEmail || 'the doctor';

    // Register session for automation runner (in-memory)
    if (req.session.refreshToken) {
      registerSession(userEmail, req.session.refreshToken);
    }

    // Get VPS JWT — prefer the one stored at login time (google auth), fall back to password-based
    let vpsJwt = req.session.vpsJwt;
    if (!vpsJwt) {
      vpsJwt = await getVpsJwt(token, userEmail);
    }

    // Persist session to VPS so automationRunner can reseed after restart (fire-and-forget)
    setVpsConfig(vpsJwt, 'automation_session', JSON.stringify({
      email: userEmail,
      refreshToken: req.session.refreshToken,
      lastSeen: new Date().toISOString(),
    })).catch(() => {});

    // Proxy to VPS /agent/chat (SSE streaming)
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
