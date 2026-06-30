import fs from 'fs';
import path from 'path';
import { DEFAULT_USER_SETTINGS, normalizeUserSettings, type UserSettings } from '../../shared/types';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'icu_settings.json');

type SettingsStore = Record<string, Partial<UserSettings>>;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): SettingsStore {
  ensureDataDir();
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
    return JSON.parse(raw) as SettingsStore;
  } catch {
    return {};
  }
}

function writeStore(store: SettingsStore): void {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

export function loadUserSettings(email: string): UserSettings {
  const store = readStore();
  return normalizeUserSettings(store[email.toLowerCase()] ?? null);
}

export function saveUserSettings(email: string, settings: Partial<UserSettings>): void {
  const store = readStore();
  store[email.toLowerCase()] = { ...DEFAULT_USER_SETTINGS, ...store[email.toLowerCase()], ...settings };
  writeStore(store);
}
