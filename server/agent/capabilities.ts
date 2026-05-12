export interface Capability {
  id: string;
  name: string;
  description: string;
  requiredConnections: string[];
  triggerTypes: string[];
  actionTypes: string[];
  endpoints: string[];
  examplePrompts: string[];
}

export const CAPABILITIES: Capability[] = [
  {
    id: 'read_gmail',
    name: 'Read Gmail Inbox',
    description: 'Read and list email threads from the Gmail inbox',
    requiredConnections: ['gmail'],
    triggerTypes: ['scheduled', 'on_demand'],
    actionTypes: ['readEmails'],
    endpoints: ['/api/admin-agent/gmail/threads'],
    examplePrompts: ['check my emails', 'what emails do I have', 'scan my inbox'],
  },
  {
    id: 'classify_email',
    name: 'Classify Email by Type',
    description: 'Classify emails as motivation letter, referral, script, or other',
    requiredConnections: ['gmail'],
    triggerTypes: ['scheduled', 'email'],
    actionTypes: ['classifyEmail'],
    endpoints: ['/api/admin-agent/gmail/threads'],
    examplePrompts: ['find referral emails', 'look for motivation letters in my inbox'],
  },
  {
    id: 'find_patient_folder',
    name: 'Find Patient Folder',
    description: 'Search for a patient folder in Google Drive by patient name',
    requiredConnections: ['googleDrive'],
    triggerTypes: ['on_demand', 'event'],
    actionTypes: ['searchDrive'],
    endpoints: ['/api/drive/patients'],
    examplePrompts: ['find folder for patient Smith', 'locate patient Govender files'],
  },
  {
    id: 'read_patient_summary',
    name: 'Read Patient Summary',
    description: 'Read the _Summary.md file from a patient folder',
    requiredConnections: ['googleDrive'],
    triggerTypes: ['on_demand', 'event'],
    actionTypes: ['readFile'],
    endpoints: ['/api/drive/patients'],
    examplePrompts: ['get patient summary for Smith', 'read patient history for Govender'],
  },
  {
    id: 'draft_letter',
    name: 'Draft a Letter',
    description: 'Generate a medical letter (motivation, referral, or feedback) via the Scribe endpoint',
    requiredConnections: ['googleDrive'],
    triggerTypes: ['on_demand', 'event'],
    actionTypes: ['draftLetter'],
    endpoints: ['/api/halo/generate-note'],
    examplePrompts: ['draft a referral letter for patient Smith', 'write a motivation letter', 'draft a pre-auth letter'],
  },
  {
    id: 'save_to_review',
    name: 'Save to Review Folder',
    description: 'Save a generated document to Halo/Review/ for doctor approval, using the PatientName_YYYY-MM-DD_DocumentType naming convention',
    requiredConnections: ['googleDrive'],
    triggerTypes: ['on_demand', 'event'],
    actionTypes: ['saveToReview'],
    endpoints: ['/api/admin-agent/drive-folders/setup'],
    examplePrompts: ['save draft to review', 'queue for my approval'],
  },
  {
    id: 'save_to_patient_letters',
    name: 'Save to Patient Letters Folder',
    description: "Save an approved document to the patient's Letters subfolder",
    requiredConnections: ['googleDrive'],
    triggerTypes: ['on_demand', 'event'],
    actionTypes: ['saveToPatientFolder'],
    endpoints: ['/api/drive/patients'],
    examplePrompts: ['file letter for patient Smith', 'save to patient folder'],
  },
  {
    id: 'create_task',
    name: 'Create Task Card',
    description: "Create a task card in the agent's task list for doctor review or follow-up",
    requiredConnections: [],
    triggerTypes: ['on_demand', 'event'],
    actionTypes: ['createTask'],
    endpoints: ['/api/admin-agent/tasks'],
    examplePrompts: ['add a task', 'remind me to', 'create a follow-up'],
  },
  {
    id: 'read_calendar',
    name: 'Read Google Calendar',
    description: 'Read upcoming calendar events and appointments',
    requiredConnections: ['googleCalendar'],
    triggerTypes: ['scheduled', 'calendar'],
    actionTypes: ['readCalendar'],
    endpoints: ['/api/calendar/events'],
    examplePrompts: ['check my calendar', 'what appointments do I have today', 'who is coming in'],
  },
  {
    id: 'generate_patient_summary',
    name: 'Generate Patient Summary',
    description: 'Generate a one-page patient summary from consultation notes and files',
    requiredConnections: ['googleDrive'],
    triggerTypes: ['on_demand', 'calendar'],
    actionTypes: ['generateSummary'],
    endpoints: ['/api/drive/patients/:id/summary'],
    examplePrompts: ['summarize patient Smith', 'generate pre-consult brief', '30 minutes before appointment'],
  },
  {
    id: 'send_email',
    name: 'Send Email via Gmail',
    description: 'Send or draft an email via the connected Gmail account',
    requiredConnections: ['gmail'],
    triggerTypes: ['on_demand', 'event'],
    actionTypes: ['sendEmail', 'draftEmail'],
    endpoints: ['/api/admin-agent/gmail/draft'],
    examplePrompts: ['send email to Dr Patel', 'draft feedback letter', 'email the referring doctor'],
  },
  {
    id: 'read_onedrive',
    name: 'Read OneDrive Folder',
    description: 'List files and folders in the connected Microsoft OneDrive',
    requiredConnections: ['onedrive'],
    triggerTypes: ['on_demand', 'scheduled'],
    actionTypes: ['readOneDrive'],
    endpoints: ['/api/admin-agent/onedrive/status'],
    examplePrompts: ['list OneDrive files', 'check OneDrive'],
  },
  {
    id: 'save_onedrive',
    name: 'Save to OneDrive',
    description: 'Save a document to the Halo folder in Microsoft OneDrive',
    requiredConnections: ['onedrive'],
    triggerTypes: ['on_demand', 'event'],
    actionTypes: ['saveToOneDrive'],
    endpoints: ['/api/admin-agent/onedrive/setup'],
    examplePrompts: ['save to OneDrive', 'file in Microsoft storage'],
  },
];

export const CAPABILITY_MAP = new Map(CAPABILITIES.map(c => [c.id, c]));

export function canExecuteCapability(capabilityId: string, connectedTools: string[]): boolean {
  const cap = CAPABILITY_MAP.get(capabilityId);
  if (!cap) return false;
  return cap.requiredConnections.every(c => connectedTools.includes(c));
}

export const PRESET_AUTOMATIONS = [
  {
    id: 'email_monitor',
    name: 'Email Monitor',
    description: 'Scan inbox for motivation letters, referrals, and scripts. Draft documents and queue for review.',
    triggerType: 'scheduled',
    defaultFrequency: '2x/day',
    frequencyOptions: ['2x/day', '3x/day', '5x/day', 'hourly'],
    requiredConnections: ['gmail', 'googleDrive'],
    capabilityIds: ['read_gmail', 'classify_email', 'draft_letter', 'save_to_review', 'create_task'],
  },
  {
    id: 'referral_feedback',
    name: 'Referral Feedback',
    description: 'After a consult note is approved and a referring doctor is identified, draft a feedback letter.',
    triggerType: 'event',
    frequencyOptions: [],
    requiredConnections: ['googleDrive', 'gmail'],
    capabilityIds: ['find_patient_folder', 'draft_letter', 'save_to_review', 'create_task'],
  },
  {
    id: 'pre_consult_summary',
    name: 'Pre-Consult Summary',
    description: '30 minutes before each calendar appointment, generate a one-page patient summary.',
    triggerType: 'calendar',
    frequencyOptions: [],
    requiredConnections: ['googleCalendar', 'googleDrive'],
    capabilityIds: ['read_calendar', 'find_patient_folder', 'generate_patient_summary'],
  },
  {
    id: 'morning_brief',
    name: 'Morning Brief',
    description: 'Each morning, summarise what the agent completed overnight.',
    triggerType: 'scheduled',
    defaultFrequency: 'daily',
    frequencyOptions: ['daily'],
    requiredConnections: [],
    capabilityIds: ['create_task'],
  },
] as const;

export type PresetAutomationId = typeof PRESET_AUTOMATIONS[number]['id'];

export interface Automation {
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

export const TIERS = [
  { id: 1, name: 'Starter', label: '500K tokens', tokens: 500_000, price: 299 },
  { id: 2, name: 'Pro', label: '2M tokens', tokens: 2_000_000, price: 799 },
  { id: 3, name: 'Enterprise', label: '5M tokens', tokens: 5_000_000, price: 1499 },
] as const;

export type TierId = 1 | 2 | 3;

export const MEMORY_INTERVIEW_QUESTIONS = [
  "What is your full name and title?",
  "What is your specialty or area of practice?",
  "Which hospital or clinic are you based at, and in which city?",
  "Do you have a preferred tone for your letters — formal, semi-formal, or informal?",
  "What information do you always want included in referral letters?",
  "Are there referring colleagues or GP practices you work with frequently?",
  "Any special instructions I should follow when drafting correspondence?",
] as const;
