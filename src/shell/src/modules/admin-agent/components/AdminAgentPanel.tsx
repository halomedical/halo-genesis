import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Send, Loader2, CheckSquare, Square, Trash2, Plus, Link2,
  FileText, RefreshCw, Bot, ListTodo, Settings, ChevronRight,
  Bell, CheckCircle2, AlertCircle, Clock, CloudOff, Zap, Mic,
  Paperclip, Camera, ChevronDown, ChevronUp, ToggleLeft, ToggleRight,
  Wifi, WifiOff, CircleCheck, Sparkles, User, ExternalLink, InboxIcon,
} from 'lucide-react';
import {
  getAgentMemory, saveAgentMemory,
  getAgentTasks, createAgentTask, updateAgentTask, deleteAgentTask,
  getAgentConnections,
  getMorningBrief, updateLastSeen,
  getAgentTier, setAgentTier, getAgentUsage,
  getAutomations, createAutomation, updateAutomation, deleteAutomation,
  getOnedriveAuthUrl, getOnedriveStatus, triggerOnedriveSetup,
  streamAgentChat, searchAgentPatients,
  type AgentTask, type AgentConnections, type MorningBrief,
  type AgentAutomation, type ChatFileAttachment, type AgentPatient,
} from '../services/api';

type PanelTab = 'chat' | 'tasks' | 'connections' | 'settings';

interface ConnectAction {
  tool: string;
  label: string;
}

interface SaveAutomationAction {
  name: string;
  trigger: string;
  frequency: string;
  description: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  connectAction?: ConnectAction | null;
  saveAutomation?: SaveAutomationAction | null;
  attachments?: { name: string; mimeType: string }[];
  patientContext?: string;
}

interface Props {
  onClose: () => void;
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

const TIERS = [
  { id: 1, name: 'Starter', label: '500K tokens', tokens: 500_000, price: 299 },
  { id: 2, name: 'Pro', label: '2M tokens', tokens: 2_000_000, price: 799 },
  { id: 3, name: 'Enterprise', label: '5M tokens', tokens: 5_000_000, price: 1499 },
] as const;

const PRESET_AUTOMATIONS = [
  {
    id: 'email_monitor',
    name: 'Email Monitor',
    description: 'Scan inbox for motivation letters, referrals, and scripts. Draft documents and queue for review.',
    triggerType: 'scheduled',
    frequencyOptions: ['2x/day', '3x/day', '5x/day', 'hourly'],
    defaultFrequency: '2x/day',
  },
  {
    id: 'referral_feedback',
    name: 'Referral Feedback',
    description: 'After a consult note is approved and a referring doctor is identified, draft a feedback letter.',
    triggerType: 'event',
    frequencyOptions: [],
  },
  {
    id: 'pre_consult_summary',
    name: 'Pre-Consult Summary',
    description: '30 minutes before each calendar appointment, generate a one-page patient summary.',
    triggerType: 'calendar',
    frequencyOptions: [],
  },
  {
    id: 'morning_brief',
    name: 'Morning Brief',
    description: 'Each morning, summarise what the agent completed overnight.',
    triggerType: 'scheduled',
    frequencyOptions: ['daily'],
    defaultFrequency: 'daily',
  },
] as const;

function parseConnectAction(text: string): { clean: string; action: ConnectAction | null } {
  const match = text.match(/\[CONNECT_ACTION:\s*(\{[^}]+\})\]/);
  if (!match) return { clean: text, action: null };
  try {
    const action = JSON.parse(match[1]) as ConnectAction;
    return { clean: text.replace(match[0], '').trim(), action };
  } catch {
    return { clean: text, action: null };
  }
}

function parseSaveAutomation(text: string): { clean: string; action: SaveAutomationAction | null } {
  const match = text.match(/\[SAVE_AUTOMATION:\s*(\{[^}]*\})\]/s);
  if (!match) return { clean: text, action: null };
  try {
    const action = JSON.parse(match[1]) as SaveAutomationAction;
    return { clean: text.replace(match[0], '').trim(), action };
  } catch {
    return { clean: text, action: null };
  }
}

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

export const AdminAgentPanel: React.FC<Props> = ({ onClose, onToast }) => {
  const [tab, setTab] = useState<PanelTab>('chat');

  // Chat state
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Attachments
  const [attachments, setAttachments] = useState<ChatFileAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  // Morning brief
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [briefDismissed, setBriefDismissed] = useState(false);

  // Tasks state
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [addingTask, setAddingTask] = useState(false);
  const [activeTaskSection, setActiveTaskSection] = useState<'review' | 'todo' | 'completed'>('review');

  // Connections state
  const [connections, setConnections] = useState<AgentConnections | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [onedrivePolling, setOnedrivePolling] = useState(false);

  // Settings — tier & usage
  const [tier, setTierState] = useState<number>(1);
  const [tierLoading, setTierLoading] = useState(false);
  const [tierSaving, setTierSaving] = useState(false);
  const [usage, setUsage] = useState<{ tokens_used: number; tokens_limit: number; reset_date: string } | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  // Settings — automations
  const [automations, setAutomations] = useState<AgentAutomation[]>([]);
  const [automationsLoading, setAutomationsLoading] = useState(false);
  const [automationsExpanded, setAutomationsExpanded] = useState(false);
  const [presetFrequencies, setPresetFrequencies] = useState<Record<string, string>>({});
  const [savingAutomationId, setSavingAutomationId] = useState<string | null>(null);

  // Settings — memory
  const [memory, setMemory] = useState('');
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryEditing, setMemoryEditing] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState('');

  // Patient selector
  const [selectedPatient, setSelectedPatient] = useState<AgentPatient | null>(null);
  const [patientQuery, setPatientQuery] = useState('');
  const [patientResults, setPatientResults] = useState<AgentPatient[]>([]);
  const [patientDropdownOpen, setPatientDropdownOpen] = useState(false);
  const patientSearchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    getMorningBrief().then(b => setBrief(b)).catch(() => {});
    updateLastSeen().catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (tab !== 'tasks') return;
    setTasksLoading(true);
    getAgentTasks()
      .then(d => {
        setTasks(d.tasks);
        const hasReview = d.tasks.some(t => t.category === 'agent' && !t.done);
        setActiveTaskSection(hasReview ? 'review' : 'todo');
      })
      .catch(() => onToast('Failed to load tasks', 'error'))
      .finally(() => setTasksLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'connections') return;
    setConnectionsLoading(true);
    getAgentConnections()
      .then(c => setConnections(c))
      .catch(() => onToast('Failed to check connections', 'error'))
      .finally(() => setConnectionsLoading(false));
  }, [tab]);

  useEffect(() => {
    if (tab !== 'settings') return;

    setTierLoading(true);
    setUsageLoading(true);
    setMemoryLoading(true);
    setAutomationsLoading(true);

    Promise.all([
      getAgentUsage().then(u => {
        setTierState(u.tier);
        setUsage({ tokens_used: u.tokens_used, tokens_limit: u.tokens_limit, reset_date: u.reset_date });
      }).catch(() => {}),
      getAutomations().then(d => {
        setAutomations(d.automations);
        // Initialise frequency state from existing preset automations
        const freqs: Record<string, string> = {};
        d.automations.filter(a => a.type === 'preset').forEach(a => {
          if (a.frequency) freqs[a.id] = a.frequency;
        });
        // Set defaults for presets not yet stored
        PRESET_AUTOMATIONS.forEach(p => {
          if (!freqs[p.id] && 'defaultFrequency' in p) freqs[p.id] = p.defaultFrequency;
        });
        setPresetFrequencies(freqs);
      }).catch(() => {}),
      getAgentMemory().then(d => {
        setMemory(d.markdown);
        setMemoryDraft(d.markdown);
      }).catch(() => onToast('Failed to load memory', 'error')),
    ]).finally(() => {
      setTierLoading(false);
      setUsageLoading(false);
      setMemoryLoading(false);
      setAutomationsLoading(false);
    });
  }, [tab]);

  // OneDrive polling
  useEffect(() => {
    if (!onedrivePolling) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        await new Promise(r => setTimeout(r, 3000));
        if (cancelled) break;
        try {
          const status = await getOnedriveStatus();
          if (status.connected) {
            setConnections(prev => prev ? { ...prev, onedrive: { connected: true } } : prev);
            setOnedrivePolling(false);
            onToast('OneDrive connected!', 'success');
            triggerOnedriveSetup().catch(() => {});
            break;
          }
        } catch { /* keep polling */ }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [onedrivePolling]);

  // Patient search debounce
  useEffect(() => {
    clearTimeout(patientSearchTimerRef.current);
    if (!patientQuery.trim()) { setPatientResults([]); return; }
    patientSearchTimerRef.current = setTimeout(async () => {
      try {
        const { patients } = await searchAgentPatients(patientQuery);
        setPatientResults(patients);
      } catch { /* ignore */ }
    }, 300);
    return () => clearTimeout(patientSearchTimerRef.current);
  }, [patientQuery]);

  // --- Voice recording ---
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          setIsTranscribing(true);
          try {
            const { transcription } = await fetch('/api/ai/transcribe', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio: base64, mimeType: 'audio/webm' }),
            }).then(r => r.json()) as { transcription: string };
            if (transcription?.trim()) {
              setInput(prev => prev ? `${prev} ${transcription.trim()}` : transcription.trim());
            }
          } catch {
            onToast('Transcription failed', 'error');
          } finally {
            setIsTranscribing(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
    } catch {
      onToast('Microphone access denied', 'error');
    }
  }, [onToast]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
    }
  }, [isRecording]);

  // --- File attach ---
  const handleFileChange = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const MAX_FILES = 3;
    const toAdd = Array.from(files).slice(0, MAX_FILES - attachments.length);
    for (const file of toAdd) {
      if (file.size > 10 * 1024 * 1024) { onToast(`${file.name} is too large (max 10MB)`, 'error'); continue; }
      try {
        const base64 = await fileToBase64(file);
        setAttachments(prev => [...prev, { name: file.name, mimeType: file.type, base64 }]);
      } catch {
        onToast(`Failed to read ${file.name}`, 'error');
      }
    }
  }, [attachments.length, onToast]);

  // --- Send message ---
  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || streaming) return;
    setInput('');
    const sentAttachments = [...attachments];
    setAttachments([]);
    const activePatient = selectedPatient;

    const userMsg: Message = {
      role: 'user',
      content: text,
      attachments: sentAttachments.map(a => ({ name: a.name, mimeType: a.mimeType })),
      patientContext: activePatient?.name,
    };
    setMessages(prev => [...prev, userMsg]);
    setStreaming(true);
    const assistantMsg: Message = { role: 'assistant', content: '' };
    setMessages(prev => [...prev, assistantMsg]);

    // Prepend patient context to the API message (transparent to user display)
    const apiText = activePatient
      ? `[Patient context: ${activePatient.name}, DOB: ${activePatient.dob}]\n${text || ''}`
      : (text || `[${sentAttachments.map(a => a.name).join(', ')}]`);

    try {
      const history = [...messages, userMsg].slice(-20);
      let fullText = '';
      await streamAgentChat(
        apiText,
        history,
        (chunk) => {
          fullText += chunk;
          setMessages(prev => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: fullText };
            return next;
          });
        },
        sentAttachments.length > 0 ? sentAttachments : undefined
      );

      // Parse special blocks after streaming completes
      let clean = fullText;
      let connectAction: ConnectAction | null = null;
      let saveAutomation: SaveAutomationAction | null = null;

      const caResult = parseConnectAction(clean);
      clean = caResult.clean;
      connectAction = caResult.action;

      const saResult = parseSaveAutomation(clean);
      clean = saResult.clean;
      saveAutomation = saResult.action;

      // Strip FLAG_CAPABILITY blocks (just clean them)
      clean = clean.replace(/\[FLAG_CAPABILITY:\s*\{[^}]*\}\]/g, '').trim();

      setMessages(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant') {
          next[next.length - 1] = { ...last, content: clean, connectAction, saveAutomation };
        }
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat failed.';
      onToast(msg, 'error');
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, streaming, messages, attachments]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // --- Tasks ---
  const addTask = async () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    setAddingTask(true);
    try {
      const { task } = await createAgentTask(title, { category: 'doctor' });
      setTasks(prev => [...prev, task]);
      setNewTaskTitle('');
    } catch { onToast('Failed to add task', 'error'); }
    finally { setAddingTask(false); }
  };

  const toggleTask = async (task: AgentTask) => {
    try {
      const { task: updated } = await updateAgentTask(task.id, { done: !task.done });
      setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
    } catch { onToast('Failed to update task', 'error'); }
  };

  const removeTask = async (id: string) => {
    try {
      await deleteAgentTask(id);
      setTasks(prev => prev.filter(t => t.id !== id));
    } catch { onToast('Failed to delete task', 'error'); }
  };

  // --- Memory ---
  const saveMemory = async () => {
    setMemorySaving(true);
    try {
      await saveAgentMemory(memoryDraft);
      setMemory(memoryDraft);
      setMemoryEditing(false);
      onToast('Memory saved', 'success');
    } catch { onToast('Failed to save memory', 'error'); }
    finally { setMemorySaving(false); }
  };

  const triggerMemoryRebuild = () => {
    setTab('chat');
    setInput('__REBUILD_MEMORY__');
    setTimeout(() => sendMessage(), 100);
  };

  // --- Tier ---
  const handleTierChange = async (newTier: number) => {
    if (newTier === tier || tierSaving) return;
    setTierSaving(true);
    try {
      await setAgentTier(newTier);
      setTierState(newTier);
      onToast('Plan updated', 'success');
    } catch { onToast('Failed to update plan', 'error'); }
    finally { setTierSaving(false); }
  };

  // --- Automations ---
  const getPresetAutomation = (presetId: string): AgentAutomation | undefined =>
    automations.find(a => a.id === presetId && a.type === 'preset');

  const togglePreset = async (presetId: string, currentEnabled: boolean) => {
    setSavingAutomationId(presetId);
    const existing = getPresetAutomation(presetId);
    try {
      if (existing) {
        const updated = await updateAutomation(existing.id, { enabled: !currentEnabled });
        setAutomations(prev => prev.map(a => a.id === existing.id ? updated.automation : a));
      } else {
        const preset = PRESET_AUTOMATIONS.find(p => p.id === presetId)!;
        const { automation } = await createAutomation({
          id: presetId,
          type: 'preset',
          name: preset.name,
          description: preset.description,
          enabled: true,
          trigger: preset.triggerType,
          frequency: presetFrequencies[presetId] || ('defaultFrequency' in preset ? preset.defaultFrequency : undefined),
          created_at: new Date().toISOString(),
        });
        setAutomations(prev => [...prev, automation]);
      }
    } catch { onToast('Failed to update automation', 'error'); }
    finally { setSavingAutomationId(null); }
  };

  const updatePresetFrequency = async (presetId: string, freq: string) => {
    setPresetFrequencies(prev => ({ ...prev, [presetId]: freq }));
    const existing = getPresetAutomation(presetId);
    if (existing) {
      try {
        const updated = await updateAutomation(existing.id, { frequency: freq });
        setAutomations(prev => prev.map(a => a.id === existing.id ? updated.automation : a));
      } catch { onToast('Failed to update frequency', 'error'); }
    }
  };

  const removeCustomAutomation = async (id: string) => {
    try {
      await deleteAutomation(id);
      setAutomations(prev => prev.filter(a => a.id !== id));
      onToast('Automation removed', 'success');
    } catch { onToast('Failed to remove automation', 'error'); }
  };

  const activateSuggestedAutomation = async (action: SaveAutomationAction) => {
    try {
      const { automation } = await createAutomation({
        type: 'custom',
        name: action.name,
        description: action.description,
        enabled: true,
        trigger: action.trigger,
        frequency: action.frequency,
        created_at: new Date().toISOString(),
      });
      setAutomations(prev => [...prev, automation]);
      onToast(`${action.name} is now active`, 'success');
    } catch { onToast('Failed to save automation', 'error'); }
  };

  // --- OneDrive ---
  const handleConnectOnedrive = async () => {
    try {
      const { authUrl } = await getOnedriveAuthUrl();
      window.open(authUrl, '_blank', 'noopener,noreferrer');
      setOnedrivePolling(true);
    } catch { onToast('Could not get OneDrive auth URL', 'error'); }
  };

  const handleConnectAction = async (action: ConnectAction) => {
    if (action.tool === 'onedrive') { setTab('connections'); await handleConnectOnedrive(); }
    else if (action.tool === 'gmail') { onToast('Sign out and sign back in to grant Gmail access.', 'info'); }
    else { setTab('connections'); }
  };

  // --- Tab config ---
  const TABS: { id: PanelTab; icon: React.ReactNode; label: string }[] = [
    { id: 'chat', icon: <Bot size={15} />, label: 'Chat' },
    { id: 'tasks', icon: <ListTodo size={15} />, label: 'Tasks' },
    { id: 'connections', icon: <Link2 size={15} />, label: 'Connect' },
    { id: 'settings', icon: <Settings size={15} />, label: 'Settings' },
  ];

  const toReviewTasks = tasks.filter(t => t.category === 'agent' && !t.done);
  const toDoTasks = tasks.filter(t => t.category !== 'agent' && !t.done);
  const completedTasks = tasks.filter(t => t.done);
  const customAutomations = automations.filter(a => a.type === 'custom');
  const usagePct = usage ? Math.min(100, (usage.tokens_used / usage.tokens_limit) * 100) : 0;

  const statusIcon = (t: AgentTask) => {
    if (t.status === 'running') return <Loader2 size={13} className="animate-spin text-cyan-500 shrink-0" />;
    if (t.status === 'failed') return <AlertCircle size={13} className="text-rose-500 shrink-0" />;
    if (t.done) return <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />;
    return null;
  };

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0 bg-slate-900">
        <div className="flex items-center gap-2.5">
          <div className="relative w-7 h-7 rounded-lg bg-cyan-500/20 flex items-center justify-center">
            <Bot size={15} className="text-cyan-400" />
            <span className="absolute inset-0 rounded-lg bg-cyan-400/20 animate-[ping_3s_ease-in-out_infinite]" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">Admin Agent</p>
            <p className="text-[10px] text-slate-400">AI Medical Secretary</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition" aria-label="Close panel">
          <X size={16} />
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-100 shrink-0">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors ${
              tab === t.id ? 'text-cyan-600' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {t.icon}
            {t.label}
            <span className={`absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-cyan-600 transition-all duration-300 ${
              tab === t.id ? 'opacity-100 scale-x-100' : 'opacity-0 scale-x-0'
            }`} />
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">

        {/* ── CHAT TAB ── */}
        {tab === 'chat' && (
          <>
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
              {brief?.hasNew && brief.brief && !briefDismissed && (
                <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2.5 relative animate-[fadeIn_0.4s_ease-out]">
                  <button onClick={() => setBriefDismissed(true)} className="absolute top-2 right-2 p-0.5 rounded text-slate-400 hover:text-slate-600 transition">
                    <X size={12} />
                  </button>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Bell size={11} className="text-cyan-600" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-700">Since your last visit</p>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-line pr-4">{brief.brief}</p>
                </div>
              )}

              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center py-8 text-slate-400">
                  <Bot size={32} className="mb-3 text-slate-300" />
                  <p className="text-sm font-medium text-slate-500">Halo Admin Agent</p>
                  <p className="text-xs mt-1 leading-relaxed px-4">Ask me to draft a letter, manage tasks, check emails, or run automations.</p>
                  <div className="mt-4 space-y-2 w-full px-2">
                    {[
                      'Draft a referral letter for patient Smith',
                      'What emails do I need to action?',
                      'Remind me before every appointment',
                    ].map(prompt => (
                      <button
                        key={prompt}
                        onClick={() => { setInput(prompt); inputRef.current?.focus(); }}
                        className="w-full text-left text-xs px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 hover:bg-cyan-50 hover:border-cyan-200 hover:-translate-y-0.5 hover:shadow-sm text-slate-600 transition-all duration-200 flex items-center gap-2"
                      >
                        <ChevronRight size={12} className="text-slate-400 shrink-0" />
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-[fadeIn_0.25s_ease-out]`} style={{ animationDelay: `${Math.min(i * 0.04, 0.2)}s`, animationFillMode: 'both' }}>
                  {msg.role === 'assistant' && (
                    <div className="w-6 h-6 rounded-full bg-cyan-600 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                      <Bot size={12} className="text-white" />
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5 max-w-[85%]">
                    {msg.patientContext && (
                      <div className="flex justify-end">
                        <span className="text-[10px] bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <User size={9} />{msg.patientContext}
                        </span>
                      </div>
                    )}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 justify-end">
                        {msg.attachments.map((a, j) => (
                          <span key={j} className="text-[10px] bg-cyan-100 text-cyan-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <Paperclip size={9} />{a.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className={`px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user' ? 'bg-cyan-600 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                    }`}>
                      {msg.content}
                      {msg.role === 'assistant' && msg.content === '' && (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                          <Loader2 size={12} className="animate-spin" />
                          <span className="text-xs">Thinking…</span>
                        </span>
                      )}
                    </div>
                    {msg.connectAction && (
                      <button
                        onClick={() => handleConnectAction(msg.connectAction!)}
                        className="self-start flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-cyan-200 text-cyan-700 text-xs font-semibold hover:bg-cyan-50 hover:shadow-sm transition-all duration-200 animate-[fadeIn_0.3s_ease-out]"
                      >
                        <Zap size={12} className="text-cyan-500" />
                        {msg.connectAction.label}
                      </button>
                    )}
                    {msg.saveAutomation && (
                      <button
                        onClick={() => activateSuggestedAutomation(msg.saveAutomation!)}
                        className="self-start flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-emerald-200 text-emerald-700 text-xs font-semibold hover:bg-emerald-50 hover:shadow-sm transition-all duration-200 animate-[fadeIn_0.3s_ease-out]"
                      >
                        <Sparkles size={12} className="text-emerald-500" />
                        Activate: {msg.saveAutomation.name}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Patient selector */}
            <div className="px-3 pt-2 shrink-0 relative">
              {selectedPatient ? (
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[10px] text-slate-400">Patient:</span>
                  <span className="flex items-center gap-1 bg-cyan-100 text-cyan-700 text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    <User size={9} />{selectedPatient.name}
                    <button onClick={() => { setSelectedPatient(null); setPatientQuery(''); }} className="ml-0.5 hover:text-rose-500 transition">
                      <X size={9} />
                    </button>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1 mb-1">
                  <User size={10} className="text-slate-300 shrink-0" />
                  <input
                    value={patientQuery}
                    onChange={e => { setPatientQuery(e.target.value); setPatientDropdownOpen(true); }}
                    onFocus={() => setPatientDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setPatientDropdownOpen(false), 150)}
                    placeholder="Add patient context…"
                    className="flex-1 text-[10px] bg-transparent outline-none text-slate-600 placeholder-slate-300"
                  />
                </div>
              )}
              {patientDropdownOpen && patientResults.length > 0 && !selectedPatient && (
                <div className="absolute left-3 right-3 bottom-full mb-1 z-50 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-36 overflow-y-auto">
                  {patientResults.map(p => (
                    <button
                      key={p.id}
                      onMouseDown={() => { setSelectedPatient(p); setPatientQuery(''); setPatientDropdownOpen(false); setPatientResults([]); }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-cyan-50 text-slate-700 transition flex items-center gap-2"
                    >
                      <User size={11} className="text-slate-400 shrink-0" />
                      <span className="font-medium">{p.name}</span>
                      <span className="text-slate-400 text-[10px] ml-auto">{p.dob}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Attachment previews */}
            {attachments.length > 0 && (
              <div className="px-3 pt-1 flex flex-wrap gap-1.5">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-slate-100 rounded-lg px-2 py-1 text-xs text-slate-700">
                    <Paperclip size={11} className="text-slate-400" />
                    <span className="max-w-[100px] truncate">{a.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-500 transition">
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Chat input */}
            <div className="px-3 pb-3 pt-2 border-t border-slate-100 shrink-0">
              <div className="flex items-end gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 focus-within:border-cyan-400 focus-within:ring-1 focus-within:ring-cyan-100 transition">
                {/* Mic button */}
                <button
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  disabled={isTranscribing || streaming}
                  className={`p-1.5 rounded-lg transition shrink-0 ${
                    isRecording ? 'bg-rose-100 text-rose-600 animate-pulse' :
                    isTranscribing ? 'text-slate-300' :
                    'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                  }`}
                  title="Hold to record voice"
                >
                  {isTranscribing ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
                </button>

                {/* File attach */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming || attachments.length >= 3}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition shrink-0 disabled:opacity-40"
                  title="Attach file"
                >
                  <Paperclip size={15} />
                </button>
                <input ref={fileInputRef} type="file" multiple accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg,.webp" className="hidden" onChange={e => handleFileChange(e.target.files)} />

                {/* Camera */}
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={streaming || attachments.length >= 3}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition shrink-0 disabled:opacity-40"
                  title="Take photo"
                >
                  <Camera size={15} />
                </button>
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => handleFileChange(e.target.files)} />

                {/* Text input */}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isRecording ? 'Recording…' : 'Ask the agent…'}
                  rows={1}
                  disabled={streaming || isRecording}
                  className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-400 resize-none outline-none max-h-32"
                  style={{ minHeight: '24px' }}
                />

                {/* Send */}
                <button
                  onClick={sendMessage}
                  disabled={(!input.trim() && attachments.length === 0) || streaming}
                  className="w-7 h-7 flex items-center justify-center rounded-lg bg-cyan-600 text-white disabled:opacity-40 transition hover:bg-cyan-500 shrink-0"
                >
                  {streaming ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 text-center">Enter to send · Shift+Enter for new line · Hold mic to record</p>
            </div>
          </>
        )}

        {/* ── TASKS TAB ── */}
        {tab === 'tasks' && (
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
            {/* Add task input — always visible above pills */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTask()}
                placeholder="Add a task…"
                className="flex-1 px-3 py-2 text-sm rounded-xl border border-slate-200 bg-white text-slate-800 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100 outline-none transition"
              />
              <button onClick={addTask} disabled={!newTaskTitle.trim() || addingTask} className="w-9 h-9 flex items-center justify-center rounded-xl bg-cyan-600 text-white disabled:opacity-40 hover:bg-cyan-500 transition">
                {addingTask ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              </button>
            </div>

            {tasksLoading ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-cyan-500" /></div>
            ) : (toReviewTasks.length === 0 && toDoTasks.length === 0 && completedTasks.length === 0) ? (
              <div className="text-center py-10 text-slate-400">
                <ListTodo size={28} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm">No tasks yet</p>
                <p className="text-xs mt-1">Ask the agent to draft a letter or set a reminder.</p>
              </div>
            ) : (
              <>
                {/* Section pills */}
                <div className="flex gap-1.5">
                  {(
                    [
                      { id: 'review' as const, label: 'To Review', count: toReviewTasks.length },
                      { id: 'todo' as const, label: 'To Do', count: toDoTasks.length },
                      { id: 'completed' as const, label: 'Completed', count: completedTasks.length },
                    ]
                  ).map(({ id, label, count }) => (
                    <button
                      key={id}
                      onClick={() => setActiveTaskSection(id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                        activeTaskSection === id
                          ? 'bg-cyan-600 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {label}
                      <span className={`text-[10px] font-bold px-1.5 py-0 rounded-full ${
                        activeTaskSection === id ? 'bg-white/25 text-white' : 'bg-slate-200 text-slate-500'
                      }`}>{count}</span>
                    </button>
                  ))}
                </div>

                {/* To Review */}
                {activeTaskSection === 'review' && (
                  <div className="space-y-1.5">
                    {toReviewTasks.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">No items to review</p>
                    ) : toReviewTasks.map(task => (
                      <div key={task.id} className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100 hover:border-amber-200 transition group">
                        <div className="mt-0.5">{statusIcon(task)}</div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800">{task.title}</p>
                          {task.agentNote && <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{task.agentNote}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {task.actionUrl && (
                            <a
                              href={task.actionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyan-600 text-white text-[10px] font-semibold hover:bg-cyan-500 transition"
                            >
                              <ExternalLink size={10} />
                              Open
                            </a>
                          )}
                          <button onClick={() => removeTask(task.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-rose-500 transition">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* To Do */}
                {activeTaskSection === 'todo' && (
                  <div className="space-y-1.5">
                    {toDoTasks.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">No tasks to do</p>
                    ) : toDoTasks.map(task => (
                      <div key={task.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-white border border-slate-100 hover:border-slate-200 transition group">
                        <button onClick={() => toggleTask(task)} className="shrink-0 text-slate-400 hover:text-cyan-600 transition">
                          <Square size={17} />
                        </button>
                        <p className="flex-1 text-sm text-slate-700">{task.title}</p>
                        <button onClick={() => removeTask(task.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-rose-500 transition">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Completed */}
                {activeTaskSection === 'completed' && (
                  <div className="space-y-1.5">
                    {completedTasks.length === 0 ? (
                      <p className="text-xs text-slate-400 text-center py-6">No completed tasks</p>
                    ) : (
                      <>
                        {completedTasks.map(task => (
                          <div key={task.id} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 group opacity-60">
                            <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                            <p className="flex-1 text-xs line-through text-slate-500">{task.title}</p>
                            <button onClick={() => removeTask(task.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-rose-500 transition">
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => completedTasks.forEach(t => removeTask(t.id))}
                          className="mt-2 w-full text-[10px] text-slate-400 hover:text-rose-500 transition text-center"
                        >
                          Clear all completed
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── CONNECTIONS TAB ── */}
        {tab === 'connections' && (
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
            {connectionsLoading ? (
              <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-cyan-500" /></div>
            ) : (
              <>
                {/* Active Connections */}
                {(connections?.gmail.connected || connections?.onedrive.connected) && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-2">Active Connections</p>
                    <div className="space-y-2">
                      {connections?.gmail.connected && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden">
                          <div className="flex items-center gap-3 px-4 py-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-slate-800">Gmail</p>
                              <p className="text-xs text-slate-500">Reading inbox · drafting emails</p>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Connected</span>
                          </div>
                        </div>
                      )}
                      {connections?.onedrive.connected && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 overflow-hidden">
                          <div className="flex items-center gap-3 px-4 py-3">
                            <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                            <div className="flex-1">
                              <p className="text-sm font-semibold text-slate-800">Microsoft OneDrive</p>
                              <p className="text-xs text-slate-500">Halo folders active</p>
                            </div>
                            <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">Connected</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Available Connections */}
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-2">Available Connections</p>
                  <div className="space-y-2">
                    {!connections?.gmail.connected && (
                      <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3 bg-white">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                            <WifiOff size={16} className="text-slate-400" />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-slate-800">Gmail</p>
                            <p className="text-xs text-slate-500">Sign out and back in to grant access</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {!connections?.onedrive.connected && (
                      <div className="rounded-xl border border-slate-200 overflow-hidden">
                        <div className="flex items-center gap-3 px-4 py-3 bg-white">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                            {onedrivePolling ? <Loader2 size={16} className="animate-spin text-cyan-500" /> : <CloudOff size={16} className="text-slate-400" />}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-slate-800">Microsoft OneDrive</p>
                            <p className="text-xs text-slate-500">{onedrivePolling ? 'Waiting for connection…' : 'Microsoft 365 storage'}</p>
                          </div>
                          {!onedrivePolling && (
                            <button onClick={handleConnectOnedrive} className="text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 px-3 py-1.5 rounded-lg transition">
                              Connect
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* WhatsApp — coming soon */}
                    <div className="rounded-xl border border-slate-200 overflow-hidden opacity-50">
                      <div className="flex items-center gap-3 px-4 py-3 bg-white">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                          <WifiOff size={16} className="text-slate-400" />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-700">WhatsApp</p>
                          <p className="text-xs text-slate-400">Coming soon</p>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-slate-100 text-slate-400">Soon</span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── SETTINGS TAB ── */}
        {tab === 'settings' && (
          <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4">

            {/* Section A — Usage & Plan */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1 mb-2">Usage &amp; Plan</p>

              {/* Tier cards */}
              {tierLoading ? (
                <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-cyan-500" /></div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {TIERS.map(t => {
                    const isActive = tier === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleTierChange(t.id)}
                        disabled={tierSaving}
                        className={`rounded-xl border p-2.5 text-left transition-all duration-200 ${
                          isActive
                            ? 'border-cyan-400 bg-cyan-50 shadow-sm shadow-cyan-100'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between mb-1">
                          <p className={`text-xs font-bold ${isActive ? 'text-cyan-700' : 'text-slate-700'}`}>{t.name}</p>
                          {isActive && <CircleCheck size={12} className="text-cyan-500 shrink-0" />}
                        </div>
                        <p className={`text-[10px] ${isActive ? 'text-cyan-600' : 'text-slate-500'}`}>{t.label}</p>
                        <p className={`text-[10px] font-bold mt-0.5 ${isActive ? 'text-cyan-600' : 'text-slate-400'}`}>R{t.price}/mo</p>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Usage bar */}
              {usage && !usageLoading && (
                <div className="mt-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-slate-600 font-medium">
                      {usage.tokens_used.toLocaleString()} <span className="text-slate-400 font-normal">of {usage.tokens_limit.toLocaleString()} tokens</span>
                    </p>
                    <p className="text-[10px] text-slate-400">{Math.round(usagePct)}% used</p>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${usagePct > 90 ? 'bg-rose-500' : usagePct > 70 ? 'bg-amber-500' : 'bg-cyan-500'}`}
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                  {usage.reset_date && (
                    <p className="text-[10px] text-slate-400 mt-1.5">Resets {new Date(usage.reset_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })}</p>
                  )}
                </div>
              )}
            </div>

            {/* Section B — Automations */}
            <div>
              <button
                onClick={() => setAutomationsExpanded(v => !v)}
                className="w-full flex items-center justify-between px-1 mb-2"
              >
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Automations</p>
                {automationsExpanded ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
              </button>

              {automationsExpanded && (
                <div className="space-y-3">
                  {/* Pre-configured */}
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="px-3 py-2.5 border-b border-slate-100">
                      <p className="text-xs font-bold text-slate-700">Pre-configured</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Toggle to activate. The agent knows how to run these.</p>
                    </div>
                    {automationsLoading ? (
                      <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-cyan-500" /></div>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {PRESET_AUTOMATIONS.map(preset => {
                          const stored = getPresetAutomation(preset.id);
                          const isEnabled = stored?.enabled ?? false;
                          const isSaving = savingAutomationId === preset.id;
                          const freq = presetFrequencies[preset.id] || ('defaultFrequency' in preset ? preset.defaultFrequency : '');
                          return (
                            <div key={preset.id} className="px-3 py-2.5">
                              <div className="flex items-start gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold text-slate-700">{preset.name}</p>
                                  <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{preset.description}</p>
                                  {preset.frequencyOptions.length > 0 && (
                                    <select
                                      value={freq}
                                      onChange={e => updatePresetFrequency(preset.id, e.target.value)}
                                      className="mt-1.5 text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-slate-600 outline-none"
                                    >
                                      {preset.frequencyOptions.map(f => (
                                        <option key={f} value={f}>{f}</option>
                                      ))}
                                    </select>
                                  )}
                                  {preset.triggerType === 'event' && (
                                    <p className="text-[10px] text-slate-400 mt-1 italic">Event-driven</p>
                                  )}
                                  {preset.triggerType === 'calendar' && (
                                    <p className="text-[10px] text-slate-400 mt-1 italic">Calendar-driven</p>
                                  )}
                                </div>
                                <button
                                  onClick={() => togglePreset(preset.id, isEnabled)}
                                  disabled={isSaving}
                                  className="shrink-0 mt-0.5"
                                >
                                  {isSaving
                                    ? <Loader2 size={20} className="animate-spin text-cyan-400" />
                                    : isEnabled
                                    ? <ToggleRight size={22} className="text-cyan-500" />
                                    : <ToggleLeft size={22} className="text-slate-300" />}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Custom automations */}
                  {customAutomations.length > 0 && (
                    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="px-3 py-2.5 border-b border-slate-100">
                        <p className="text-xs font-bold text-slate-700">Custom</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Defined conversationally from chat.</p>
                      </div>
                      <div className="divide-y divide-slate-50">
                        {customAutomations.map(auto => (
                          <div key={auto.id} className="px-3 py-2.5 flex items-start gap-2 group">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="text-xs font-semibold text-slate-700">{auto.name}</p>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${auto.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                  {auto.enabled ? 'Active' : 'Paused'}
                                </span>
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{auto.description}</p>
                              {auto.frequency && <p className="text-[10px] text-slate-400 mt-0.5 italic">{auto.frequency}</p>}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  updateAutomation(auto.id, { enabled: !auto.enabled })
                                    .then(r => setAutomations(prev => prev.map(a => a.id === auto.id ? r.automation : a)))
                                    .catch(() => onToast('Failed to update', 'error'));
                                }}
                                className="p-1 rounded text-slate-400 hover:text-cyan-600 transition"
                              >
                                {auto.enabled ? <ToggleRight size={18} className="text-cyan-500" /> : <ToggleLeft size={18} className="text-slate-300" />}
                              </button>
                              <button onClick={() => removeCustomAutomation(auto.id)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-rose-500 transition">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {customAutomations.length === 0 && !automationsLoading && (
                    <p className="text-xs text-slate-400 text-center py-2">
                      No custom automations yet. Ask me in chat: "always do X when Y happens."
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Section C — Agent Memory */}
            <div>
              <div className="flex items-center justify-between px-1 mb-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Agent Memory</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={triggerMemoryRebuild}
                    className="text-[10px] font-semibold text-slate-500 hover:text-cyan-600 transition flex items-center gap-1"
                  >
                    <RefreshCw size={10} />
                    Rebuild
                  </button>
                  {!memoryEditing ? (
                    <button onClick={() => { setMemoryDraft(memory); setMemoryEditing(true); }} className="text-[10px] font-semibold text-cyan-600 hover:text-cyan-700 transition">
                      Edit
                    </button>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => setMemoryEditing(false)} className="text-[10px] text-slate-500 hover:text-slate-700">Cancel</button>
                      <button onClick={saveMemory} disabled={memorySaving} className="text-[10px] font-bold text-cyan-600 hover:text-cyan-700 disabled:opacity-50">
                        {memorySaving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-[10px] text-slate-400 px-1 mb-2">The agent reads this before every conversation.</p>

              {memoryLoading ? (
                <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-cyan-500" /></div>
              ) : memoryEditing ? (
                <textarea
                  value={memoryDraft}
                  onChange={e => setMemoryDraft(e.target.value)}
                  className="w-full text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3 resize-none outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-100 transition leading-relaxed"
                  style={{ minHeight: '220px' }}
                />
              ) : (
                <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs font-mono text-slate-700 whitespace-pre-wrap leading-relaxed">
                  <FileText size={12} className="inline mr-1.5 text-slate-400" />
                  {memory || 'No memory file yet.'}
                </div>
              )}

              <p className="text-[10px] text-slate-400 text-center mt-2">
                Stored as <code className="bg-slate-100 px-1 rounded">halo_agent_memory.md</code> in your Drive.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
