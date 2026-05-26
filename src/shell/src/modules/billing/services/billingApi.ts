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

function normalizeBillingErrorMessage(data: unknown, status: number): string {
  if (typeof data === 'string' && data.trim()) return data.trim();
  if (!data || typeof data !== 'object') return `Billing API request failed (${status})`;

  const body = data as Record<string, unknown>;
  const messageField = body.message;
  if (typeof messageField === 'string' && messageField.trim()) {
    return messageField.trim();
  }
  if (Array.isArray(messageField)) {
    const parts = messageField
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    if (parts.length > 0) return parts.join(' | ');
  }

  const errorField = body.error;
  if (typeof errorField === 'string' && errorField.trim()) {
    return errorField.trim();
  }

  return `Billing API request failed (${status})`;
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

export interface BillingEligibilityPayload {
  requestType?: 'normal' | 'family' | 'auth' | 'exclusion' | 'auth_and_exclusion' | string;
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
