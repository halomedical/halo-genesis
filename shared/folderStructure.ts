export const HALO_ROOT_NAME = 'Halo_Patients';

export const PATIENT_SUBFOLDERS = [
  'Clerking Sheets',
  'Letters',
  'Radiology',
  'Labs',
  'Scanned Documents',
  'Subspecialist Referral',
] as const;

export type PatientSubfolder = typeof PATIENT_SUBFOLDERS[number];

export const HALO_SUBFOLDERS = [
  'Black Hole',
  'Review',
  'Billing',
  'Archive',
] as const;

export type HaloSubfolder = typeof HALO_SUBFOLDERS[number];

export const REVIEW_FOLDER = 'Review';
export const PATIENT_SUMMARY_FILE = '_Summary.md';
