import type { Request } from 'express';
import { findActiveUser } from './userStore';
import { loadUserSettings } from './settingsStore';

export interface ClinicianProfile {
  displayName: string;
  email: string;
  mpNumber: string;
  signatureText: string;
}

export function resolveClinicianProfile(req: Request): ClinicianProfile | null {
  const email = req.session.userEmail?.trim().toLowerCase();
  if (!email) return null;

  const settings = loadUserSettings(email);
  const managed = findActiveUser(email);
  const displayName =
    req.session.userName?.trim() ||
    managed?.name?.trim() ||
    email;

  const mpNumber = settings.mpNumber?.trim() || managed?.mpNumber?.trim() || '';
  const signatureText = settings.signature?.trim() || managed?.signature?.trim() || '';

  return {
    displayName,
    email,
    mpNumber,
    signatureText,
  };
}
