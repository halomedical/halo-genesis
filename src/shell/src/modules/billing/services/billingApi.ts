const BILLING_API_BASE =
  (import.meta.env.VITE_BILLING_API_BASE as string | undefined) ||
  'https://medikredit-integration-dev-17803b194e77.herokuapp.com';
const BILLING_API_KEY = import.meta.env.VITE_MEDIKREDIT_API_KEY as string | undefined;

export class BillingApiError extends Error {
  status: number;
  body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'BillingApiError';
    this.status = status;
    this.body = body;
  }
}

<<<<<<< HEAD
function extractMessageFromBody(body: Record<string, unknown>): string | null {
=======
function normalizeBillingErrorMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (!data || typeof data !== 'object') return `Billing API request failed (${status})`;

  const body = data as Record<string, unknown>;
>>>>>>> origin/staging
  const messageField = body.message;
  if (typeof messageField === 'string' && messageField.trim()) {
    return messageField.trim();
  }
  if (Array.isArray(messageField)) {
    const parts = messageField
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
<<<<<<< HEAD
    if (parts.length > 0) return parts.join('; ');
  }
=======
    if (parts.length > 0) return parts.join(' | ');
  }

>>>>>>> origin/staging
  const errorField = body.error;
  if (typeof errorField === 'string' && errorField.trim()) {
    return errorField.trim();
  }
<<<<<<< HEAD
  return null;
}

function extractDetailsFromBody(body: Record<string, unknown>): string | null {
  const details = body.details;
  if (typeof details === 'string' && details.trim()) return details.trim();
  if (Array.isArray(details)) {
    const parts = details
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) return parts.join('; ');
  }
  return null;
}

function normalizeBillingErrorMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (!data || typeof data !== 'object') {
    return status === 0
      ? 'Billing API unreachable (network or CORS). Check VITE_BILLING_API_BASE and that the server is running.'
      : `Billing API request failed (HTTP ${status})`;
  }

  const body = data as Record<string, unknown>;
  const parts: string[] = [];

  const primary = extractMessageFromBody(body);
  if (primary) parts.push(primary);

  const details = extractDetailsFromBody(body);
  if (details && details !== primary) parts.push(details);

  if (typeof body.transactionNumber === 'string' && body.transactionNumber.trim()) {
    parts.push(`Transaction ${body.transactionNumber.trim()}`);
  }

  if (Array.isArray(body.reversalMessages)) {
    const mk = body.reversalMessages
      .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
      .join('; ');
    if (mk) parts.push(`MediKredit: ${mk}`);
  }

  if (parts.length > 0) return parts.join(' — ');

  return `Billing API request failed (HTTP ${status})`;
}

/** User-facing error text for billing toasts and inline alerts. */
export function formatBillingError(error: unknown, context?: string): string {
  const prefix = context ? `${context}: ` : '';

  if (error instanceof BillingApiError) {
    const lines: string[] = [];
    const core = error.message?.trim() || `Request failed (HTTP ${error.status || '?'})`;
    lines.push(`${prefix}${core}`);

    if (error.body && typeof error.body === 'object') {
      const body = error.body as Record<string, unknown>;
      const details = extractDetailsFromBody(body);
      if (details && !core.includes(details)) {
        lines.push(details);
      }
      if (typeof body.transactionNumber === 'string' && !core.includes(body.transactionNumber)) {
        lines.push(`Transaction ${body.transactionNumber}`);
      }
      if (Array.isArray(body.reversalMessages)) {
        const mk = body.reversalMessages
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
          .join('; ');
        if (mk && !core.includes(mk)) lines.push(`MediKredit: ${mk}`);
      }
    }

    if (error.status === 401) {
      lines.push('Check VITE_MEDIKREDIT_API_KEY matches the billing API key.');
    } else if (error.status === 502) {
      lines.push('MediKredit test service may be down or certificates misconfigured on the server.');
    } else if (error.status === 400) {
      lines.push('Fix the form fields shown above, or load the original claim details before reversing.');
    } else if (!BILLING_API_KEY) {
      lines.push('VITE_MEDIKREDIT_API_KEY is not set in this build.');
    }

    return lines.join(' — ');
  }

  if (error instanceof Error) return `${prefix}${error.message}`;
  return `${prefix}Something went wrong. Please try again.`;
=======

  return `Billing API request failed (${status})`;
>>>>>>> origin/staging
}

async function billingRequest<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const base = BILLING_API_BASE.replace(/\/$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(BILLING_API_KEY ? { 'x-api-key': BILLING_API_KEY } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    throw new BillingApiError(
      `Billing API unreachable. ${error instanceof Error ? error.message : 'Unknown error'}`,
      0
    );
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  let data: unknown = null;
  if (isJson) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  } else {
    try {
      data = await res.text();
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const message = normalizeBillingErrorMessage(data, res.status);
    throw new BillingApiError(message, res.status, data);
  }

  return data as T;
}

export interface StoredClaimRecord {
  id: string;
  transactionNumber?: string;
  memberNumber: string;
  patientFirstName?: string;
  patientLastName?: string;
  dependantCode?: string;
  lineItemsSummary?: Array<{
    procedureCode: string;
    description?: string;
    quantity: number;
    unitPriceCents: number;
    totalPriceCents: number;
    serviceDate: string;
  }>;
  status: string;
  messages: string[];
  reversed: boolean;
  reversalStatus?: string;
  reversalMessages: string[];
<<<<<<< HEAD
  /** Present on GET /claims/:id — use to autofill reversal with the same transaction details. */
  requestPayload?: BillingClaimCreatePayload;
=======
>>>>>>> origin/staging
  totalClaimedCents?: number;
  totalPaidCents?: number;
  varianceCents?: number;
  totalLineItems?: number;
  createdAt: string;
  updatedAt: string;
}

export interface BillingPatientPayload {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  initials?: string;
  statusIndicator?: string;
  dependantCode?: string;
  idNumber?: string;
  memberNumber: string;
  planCode?: string;
}

export interface BillingProviderPayload {
  name: string;
  practiceNumber?: string;
  hpcNumber?: string;
  bhfNumber?: string;
  groupPracticeNumber?: string;
}

export interface BillingDiagnosisPayload {
  code: string;
  description?: string;
}

export interface BillingClaimLineItemPayload {
  procedureCode: string;
  description?: string;
  quantity: number;
<<<<<<< HEAD
  baseTariffCents?: number;
  tariffPercent?: number;
=======
>>>>>>> origin/staging
  unitPriceCents: number;
  totalPriceCents: number;
  serviceDate: string;
}

export interface BillingClaimOtherPayload {
  wcaNumber?: string;
  insuranceReferenceNumber?: string;
  dateOfAccident?: string;
}

export interface BillingClaimCreatePayload {
  externalReference?: string;
  patient: BillingPatientPayload;
  provider: BillingProviderPayload;
  diagnoses: BillingDiagnosisPayload[];
  lineItems: BillingClaimLineItemPayload[];
  other?: BillingClaimOtherPayload;
}

export interface BillingClaimReversePayload extends BillingClaimCreatePayload {
  transactionNumber: string;
}

export interface ClaimResultDto {
  claimId?: string;
  status: 'pending' | 'accepted' | 'rejected' | string;
  authorizationNumber?: string;
  transactionNumber?: string;
  messages: string[];
}

<<<<<<< HEAD
export type EligibilityRequestType =
  | 'normal'
  | 'family'
  | 'auth'
  | 'exclusion'
  | 'auth_and_exclusion';

export interface EligibilityRequestTypeOption {
  value: EligibilityRequestType;
  label: string;
  description: string;
  requiresMemberNumber: boolean;
}

/** MediKredit eligibility modes mapped to tx_cd 20–33. */
export const ELIGIBILITY_REQUEST_TYPE_OPTIONS: EligibilityRequestTypeOption[] = [
  {
    value: 'normal',
    label: 'Normal',
    description: 'Standard day-to-day eligibility before submitting a claim. Supports ID-only checks.',
    requiresMemberNumber: false,
  },
  {
    value: 'family',
    label: 'Family (FAMCHECK)',
    description: 'Confirm dependant and family membership details for the member.',
    requiresMemberNumber: true,
  },
  {
    value: 'auth',
    label: 'Authorisation (AUTHCHECK)',
    description: 'Check whether services may require pre-authorisation.',
    requiresMemberNumber: true,
  },
  {
    value: 'exclusion',
    label: 'Exclusion (AUTHCHECK)',
    description: 'Check whether treatment may be excluded by plan rules.',
    requiresMemberNumber: true,
  },
  {
    value: 'auth_and_exclusion',
    label: 'Auth + exclusion',
    description: 'Combined pre-check for both authorisation and exclusion risk.',
    requiresMemberNumber: true,
  },
];

export function normalizeEligibilityRequestType(
  value: string | undefined,
): EligibilityRequestType {
  const match = ELIGIBILITY_REQUEST_TYPE_OPTIONS.find((opt) => opt.value === value);
  return match?.value ?? 'normal';
}

export function eligibilityRequiresMemberNumber(
  requestType: EligibilityRequestType | string | undefined,
): boolean {
  const normalized = normalizeEligibilityRequestType(
    typeof requestType === 'string' ? requestType : undefined,
  );
  return (
    ELIGIBILITY_REQUEST_TYPE_OPTIONS.find((opt) => opt.value === normalized)
      ?.requiresMemberNumber ?? false
  );
}

export interface BillingEligibilityPayload {
  requestType?: EligibilityRequestType | string;
=======
export interface BillingEligibilityPayload {
  requestType?: 'normal' | 'family' | 'auth' | 'exclusion' | 'auth_and_exclusion' | string;
>>>>>>> origin/staging
  memberNumber?: string;
  schemeCode?: string;
  planCode?: string;
  dependantCode?: string;
  patientDateOfBirth?: string;
  patientIdNumber?: string;
  patientFirstName?: string;
  patientLastName?: string;
  patientInitials?: string;
  serviceDate: string;
  providerPracticeNumber?: string;
  bhfNumber?: string;
  groupPracticeNumber?: string;
}

export interface EligibilityResponseDto {
  status: 'eligible' | 'ineligible' | 'unknown' | string;
  messages: string[];
}

export const billingGetClaims = (params?: { limit?: number; offset?: number }) => {
  const qs = new URLSearchParams();
  if (typeof params?.limit === 'number') qs.set('limit', String(params.limit));
  if (typeof params?.offset === 'number') qs.set('offset', String(params.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return billingRequest<StoredClaimRecord[]>(`/claims${suffix}`);
};

export const billingGetClaimById = (id: string) =>
  billingRequest<StoredClaimRecord>(`/claims/${encodeURIComponent(id)}`);

export const billingSubmitClaim = (payload: BillingClaimCreatePayload) =>
  billingRequest<ClaimResultDto>('/claims', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const billingReverseClaim = (payload: BillingClaimReversePayload) =>
  billingRequest<ClaimResultDto>('/claims/reversal', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const billingCheckEligibility = (payload: BillingEligibilityPayload) =>
  billingRequest<EligibilityResponseDto>('/eligibility-checks', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
