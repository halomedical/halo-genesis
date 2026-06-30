export type SignatureMode = 'none' | 'typed' | 'image';

export interface SignatureOptions {
  includeSignature?: boolean;
  mode?: SignatureMode;
}

export interface SignatureAssetMetadata {
  fileId: string;
  mimeType: 'image/png';
  updatedAt: string;
  source: 'upload' | 'drawn';
}

export interface SignaturePolicy {
  key: string;
  label: string;
  allowedModes: SignatureMode[];
  defaultMode: SignatureMode;
  defaultIncluded: boolean;
  requiresExplicitConsent: boolean;
}

const SIGNABLE_MODES: SignatureMode[] = ['none', 'typed', 'image'];

export const DOCUMENT_SIGNATURE_POLICIES: Record<string, SignaturePolicy> = {
  halo_scripts: {
    key: 'halo_scripts',
    label: 'Scripts',
    allowedModes: SIGNABLE_MODES,
    defaultMode: 'image',
    defaultIncluded: false,
    requiresExplicitConsent: true,
  },
  halo_blank_report: {
    key: 'halo_blank_report',
    label: 'Medical reports',
    allowedModes: SIGNABLE_MODES,
    defaultMode: 'image',
    defaultIncluded: false,
    requiresExplicitConsent: true,
  },
  halo_note: {
    key: 'halo_note',
    label: 'Halo-generated documents',
    allowedModes: SIGNABLE_MODES,
    defaultMode: 'typed',
    defaultIncluded: false,
    requiresExplicitConsent: true,
  },
  icu_daily_note: {
    key: 'icu_daily_note',
    label: 'ICU daily notes',
    allowedModes: SIGNABLE_MODES,
    defaultMode: 'typed',
    defaultIncluded: false,
    requiresExplicitConsent: true,
  },
  icu_ward_round: {
    key: 'icu_ward_round',
    label: 'ICU ward round notes',
    allowedModes: SIGNABLE_MODES,
    defaultMode: 'typed',
    defaultIncluded: false,
    requiresExplicitConsent: true,
  },
  icu_discharge_summary: {
    key: 'icu_discharge_summary',
    label: 'ICU discharge summaries',
    allowedModes: SIGNABLE_MODES,
    defaultMode: 'image',
    defaultIncluded: false,
    requiresExplicitConsent: true,
  },
  transplant_document: {
    key: 'transplant_document',
    label: 'Transplant documents',
    allowedModes: SIGNABLE_MODES,
    defaultMode: 'image',
    defaultIncluded: false,
    requiresExplicitConsent: true,
  },
  pdf_filler: {
    key: 'pdf_filler',
    label: 'Filled PDF forms',
    allowedModes: SIGNABLE_MODES,
    defaultMode: 'image',
    defaultIncluded: false,
    requiresExplicitConsent: true,
  },
};

export function getSignaturePolicy(key: string): SignaturePolicy {
  return DOCUMENT_SIGNATURE_POLICIES[key] ?? DOCUMENT_SIGNATURE_POLICIES.halo_note;
}

export function getHaloSignaturePolicyKey(templateId: string): string {
  if (templateId === 'scripts') return 'halo_scripts';
  if (templateId === 'blank_report' || templateId === 'medical_report') return 'halo_blank_report';
  return 'halo_note';
}

export function normalizeSignatureOptions(
  raw: SignatureOptions | null | undefined,
  policy: SignaturePolicy,
  hasImageSignature: boolean
): Required<SignatureOptions> {
  if (!raw?.includeSignature) {
    return { includeSignature: false, mode: 'none' };
  }

  const requestedMode = raw.mode && policy.allowedModes.includes(raw.mode)
    ? raw.mode
    : policy.defaultMode;
  const mode = requestedMode === 'image' && !hasImageSignature
    ? (policy.allowedModes.includes('typed') ? 'typed' : 'none')
    : requestedMode;

  return {
    includeSignature: mode !== 'none',
    mode,
  };
}
