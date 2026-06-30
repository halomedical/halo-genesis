import fs from 'fs';
import path from 'path';
import { config } from '../config';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'icu_users.json');

export interface ManagedUser {
  email: string;
  name: string;
  role: 'consultant' | 'registrar';
  mpNumber: string;
  signature: string;
  invitedAt: string;
  invitedBy: string;
  active: boolean;
}

interface UsersStore {
  users: ManagedUser[];
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readUsers(): ManagedUser[] {
  ensureDataDir();
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const store = JSON.parse(raw) as UsersStore;
    return (store.users ?? []).map((u) => ({
      ...u,
      role: ((u as { role?: 'consultant' | 'registrar' }).role) ?? 'registrar',
    }));
  } catch {
    return [];
  }
}

function writeUsers(users: ManagedUser[]): void {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
}

export function isAllowedUser(email: string): boolean {
  const users = readUsers();
  return users.some((u) => u.email.toLowerCase() === email.toLowerCase() && u.active !== false);
}

export function findActiveUser(email: string): ManagedUser | null {
  const lower = email.toLowerCase();
  return readUsers().find((u) => u.email.toLowerCase() === lower && u.active !== false) ?? null;
}

export function addUser(user: ManagedUser): void {
  const users = readUsers();
  const idx = users.findIndex((u) => u.email.toLowerCase() === user.email.toLowerCase());
  if (idx >= 0) {
    users[idx] = user;
  } else {
    users.push(user);
  }
  writeUsers(users);
}

export function isConsultant(email: string): boolean {
  const lower = email.toLowerCase();
  if (lower === config.adminEmail.toLowerCase()) return true;
  const users = readUsers();
  const user = users.find((u) => u.email.toLowerCase() === lower && u.active !== false);
  return user?.role === 'consultant';
}

export function removeUser(email: string): boolean {
  const users = readUsers();
  const filtered = users.filter((u) => u.email.toLowerCase() !== email.toLowerCase());
  if (filtered.length === users.length) return false;
  writeUsers(filtered);
  return true;
}
