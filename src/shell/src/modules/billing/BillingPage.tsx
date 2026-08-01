import React, { useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  billingGetClaims,
  billingGetClaimById,
  billingCheckEligibility,
  billingSubmitClaim,
  billingReverseClaim,
  type BillingClaimCreatePayload,
  type BillingEligibilityPayload,
  type EligibilityResponseDto,
  type StoredClaimRecord,
} from './services/billingApi';
import {
  MEDIKREDIT_DIAGNOSIS_OPTIONS,
  MEDIKREDIT_LINE_ITEM_OPTIONS,
} from './services/claimOptions';
import type { Patient, UserSettings } from '../../../../../shared/types';
import { DEFAULT_PATIENT_NAMING, type PatientNamingConfig } from '../../../../../shared/patientNaming';
import {
  formatPatientDisplayName,
  formatPatientSubtitle,
} from '../../../../../shared/patientNamingEngine';
import {
  appendPatientBillingClaim,
  appendPatientBillingEligibility,
  fetchPatientBillingClaims,
} from './services/api';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

type ClaimsSubTab = 'list' | 'submit' | 'reverse';

const LS_LAST_SUBMIT = 'halo_billing_last_submit_payload_v1';
const LS_LAST_ELIGIBILITY = 'halo_billing_last_eligibility_payload_v1';
const LS_SUBMITTED_BY_TX = 'halo_billing_submitted_by_tx_v1';
const LS_HIDDEN_CLAIM_IDS = 'halo_billing_hidden_claim_ids_v1';

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function getEmptyClaimPayload(): BillingClaimCreatePayload {
  return {
    externalReference: '',
    patient: {
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      initials: '',
      statusIndicator: '',
      dependantCode: '',
      idNumber: '',
      memberNumber: '',
      planCode: '',
    },
    provider: {
      name: '',
      practiceNumber: '',
      hpcNumber: '',
      bhfNumber: '',
      groupPracticeNumber: '',
    },
    diagnoses: [{ code: '', description: '' }],
    lineItems: [
      {
        procedureCode: '',
        description: '',
        quantity: 1,
        unitPriceCents: 0,
        totalPriceCents: 0,
        serviceDate: getTodayIsoDate(),
      },
    ],
    other: {
      wcaNumber: '',
      insuranceReferenceNumber: '',
      dateOfAccident: '',
    },
  };
}

export function BillingPage({
  onToast,
  patients,
  selectedPatientId,
  userSettings,
  patientNaming = DEFAULT_PATIENT_NAMING,
}: {
  onToast: ToastFn;
  patients: Patient[];
  selectedPatientId: string | null;
  userSettings: UserSettings | null;
  patientNaming?: PatientNamingConfig;
}) {
  const [billingPatientId, setBillingPatientId] = useState<string>('');

  const effectivePatientId = billingPatientId || selectedPatientId || '';
  const effectivePatient = effectivePatientId ? patients.find(p => p.id === effectivePatientId) : undefined;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 md:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-4">
        <header className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm md:px-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-slate-800">Billing</h1>
              <p className="text-sm text-slate-500">
                MediKredit Integration (dev). Check eligibility inline before submitting claims.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="min-w-[260px]">
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  value={effectivePatientId}
                  onChange={(e) => setBillingPatientId(e.target.value)}
                >
                  <option value="">Select patient…</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {formatPatientDisplayName(p, patientNaming)}
                      {formatPatientSubtitle(p, patientNaming)
                        ? ` (${formatPatientSubtitle(p, patientNaming)})`
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </header>

        <ClaimsTab
          onToast={onToast}
          patient={effectivePatient}
          userSettings={userSettings}
          patientNaming={patientNaming}
        />
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-2 border-b border-slate-100 px-4 py-4 md:flex-row md:items-start md:justify-between md:px-6">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
          {subtitle ? <p className="text-sm text-slate-500">{subtitle}</p> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="px-4 py-4 md:px-6">{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">{children}</label>;
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100 ${
        props.className || ''
      }`}
    />
  );
}

function SmallButton({
  onClick,
  children,
  variant = 'primary',
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const styles =
    variant === 'primary'
      ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-sm shadow-cyan-600/20'
      : variant === 'danger'
        ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm shadow-rose-600/20'
        : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition active:scale-[0.99] disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

function formatCents(cents?: number | null): string {
  if (typeof cents !== 'number') return '';
  const rands = cents / 100;
  return rands.toLocaleString(undefined, { style: 'currency', currency: 'ZAR' });
}

function sumClaimTotalCents(payload?: BillingClaimCreatePayload | null): number | null {
  if (!payload?.lineItems?.length) return null;
  const total = payload.lineItems.reduce((acc, li) => acc + (Number(li.totalPriceCents) || 0), 0);
  return Number.isFinite(total) ? total : null;
}

function formatMoneyOrDash(cents?: number | null): string {
  if (typeof cents !== 'number') return '—';
  return formatCents(cents);
}

function renderLineItemsSummary(claim: StoredClaimRecord) {
  const items = claim.lineItemsSummary || [];
  if (!items.length) return null;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Line items summary</p>
      <div className="mt-2 space-y-2">
        {items.map((li, idx) => (
          <div
            key={`${li.procedureCode}-${li.serviceDate}-${idx}`}
            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-slate-800">
                {li.procedureCode} {li.description ? `— ${li.description}` : ''}
              </p>
              <span className="shrink-0 text-xs font-semibold text-slate-600">
                {formatCents(li.totalPriceCents)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Qty {li.quantity} • Unit {formatCents(li.unitPriceCents)} • {li.serviceDate}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: fullName.trim(), lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

function toInitials(firstName: string, lastName: string): string {
  const first = (firstName || '').trim();
  const last = (lastName || '').trim();
  const a = first ? first[0] : '';
  const b = last ? last[0] : '';
  const initials = `${a}${b}`.toUpperCase();
  return initials.replace(/[^A-Z]/g, '').slice(0, 5);
}

function toUpperOrEmpty(value: string | undefined | null): string {
  return (value ?? '').toUpperCase();
}

function compactClaimPayload(payload: BillingClaimCreatePayload): BillingClaimCreatePayload {
  const trimOrUndefined = (value: string | undefined) => {
    const v = (value ?? '').trim();
    return v.length ? v : undefined;
  };

  const compactOther = payload.other
    ? {
        wcaNumber: trimOrUndefined(payload.other.wcaNumber),
        insuranceReferenceNumber: trimOrUndefined(payload.other.insuranceReferenceNumber),
        dateOfAccident: trimOrUndefined(payload.other.dateOfAccident),
      }
    : undefined;

  const hasOther = compactOther
    ? Object.values(compactOther).some((value) => typeof value === 'string' && value.length > 0)
    : false;

  return {
    ...payload,
    externalReference: trimOrUndefined(payload.externalReference),
    patient: {
      ...payload.patient,
      initials: trimOrUndefined(payload.patient.initials),
      statusIndicator: trimOrUndefined(payload.patient.statusIndicator),
      dependantCode: trimOrUndefined(payload.patient.dependantCode),
      idNumber: trimOrUndefined(payload.patient.idNumber),
      planCode: trimOrUndefined(payload.patient.planCode),
    },
    provider: {
      ...payload.provider,
      practiceNumber: trimOrUndefined(payload.provider.practiceNumber),
      hpcNumber: trimOrUndefined(payload.provider.hpcNumber),
      bhfNumber: trimOrUndefined(payload.provider.bhfNumber),
      groupPracticeNumber: trimOrUndefined(payload.provider.groupPracticeNumber),
    },
    diagnoses: payload.diagnoses.map((d) => ({
      ...d,
      description: trimOrUndefined(d.description),
    })),
    lineItems: payload.lineItems.map((li) => ({
      ...li,
      description: trimOrUndefined(li.description),
    })),
    other: hasOther ? compactOther : undefined,
  };
}

function compactEligibilityPayload(p: BillingEligibilityPayload): BillingEligibilityPayload {
  const compact = (value: string | undefined) => {
    const v = (value ?? '').trim();
    return v.length ? v : undefined;
  };

  return {
    requestType: compact(p.requestType) || 'normal',
    memberNumber: compact(p.memberNumber),
    serviceDate: p.serviceDate,
    schemeCode: compact(p.schemeCode)?.toUpperCase(),
    planCode: compact(p.planCode),
    dependantCode: compact(p.dependantCode),
    patientDateOfBirth: compact(p.patientDateOfBirth),
    patientIdNumber: compact(p.patientIdNumber),
    patientFirstName: compact(p.patientFirstName),
    patientLastName: compact(p.patientLastName),
    patientInitials: compact(p.patientInitials),
    providerPracticeNumber: compact(p.providerPracticeNumber),
    bhfNumber: compact(p.bhfNumber),
    groupPracticeNumber: compact(p.groupPracticeNumber),
  };
}

function ClaimsTab({
  onToast,
  patient,
  userSettings,
  patientNaming = DEFAULT_PATIENT_NAMING,
}: {
  onToast: ToastFn;
  patient?: Patient;
  userSettings: UserSettings | null;
  patientNaming?: PatientNamingConfig;
}) {
  const [subTab, setSubTab] = useState<ClaimsSubTab>('list');
  const [claims, setClaims] = useState<StoredClaimRecord[] | null>(null);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<StoredClaimRecord | null>(null);
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const claimDetailReqIdRef = useRef(0);
  const pollTimerRef = useRef<number | null>(null);
  const [patientClaims, setPatientClaims] = useState<unknown[] | null>(null);
  const [patientClaimsLoading, setPatientClaimsLoading] = useState(false);
  const [expandedPatientHistoryKey, setExpandedPatientHistoryKey] = useState<string | null>(null);
  const [hiddenClaimIds, setHiddenClaimIds] = useState<string[]>(
    () => readJson<string[]>(LS_HIDDEN_CLAIM_IDS) || []
  );

  const [submitPayload, setSubmitPayload] = useState<BillingClaimCreatePayload>(() => {
    const saved = readJson<BillingClaimCreatePayload>(LS_LAST_SUBMIT);
    return saved ?? getEmptyClaimPayload();
  });

  const [reversalTx, setReversalTx] = useState('');
  const [reversalPayload, setReversalPayload] = useState<BillingClaimCreatePayload>(() => {
    const saved = readJson<BillingClaimCreatePayload>(LS_LAST_SUBMIT);
    return saved ?? getEmptyClaimPayload();
  });
  const [claimEligibilityResult, setClaimEligibilityResult] = useState<EligibilityResponseDto | null>(null);
  const [claimEligibilityLoading, setClaimEligibilityLoading] = useState(false);

  const applyPatientToClaim = (base: BillingClaimCreatePayload): BillingClaimCreatePayload => {
    if (!patient) return base;
    const name = splitName(patient.name || '');
    const providerDefaults = userSettings?.billing?.provider;
    return {
      ...base,
      patient: {
        ...base.patient,
        firstName: toUpperOrEmpty(name.firstName) || base.patient.firstName,
        lastName: toUpperOrEmpty(name.lastName) || base.patient.lastName,
        dateOfBirth: patient.dob && patient.dob !== 'Unknown' ? patient.dob : base.patient.dateOfBirth,
        initials: patient.initials || (base.patient.initials?.trim() ? base.patient.initials : toInitials(name.firstName, name.lastName)),
        statusIndicator: patient.statusIndicator || base.patient.statusIndicator,
        idNumber: patient.idNumber || base.patient.idNumber,
        dependantCode: patient.dependantCode || base.patient.dependantCode,
        planCode: patient.planCode || patient.medicalAidPlan || userSettings?.billing?.planCode || base.patient.planCode,
        memberNumber: patient.memberNumber || patient.medicalAidNumber || base.patient.memberNumber,
      },
      provider: {
        ...base.provider,
        name: providerDefaults?.name || base.provider.name,
        practiceNumber: providerDefaults?.practiceNumber || base.provider.practiceNumber,
        hpcNumber: providerDefaults?.hpcNumber || base.provider.hpcNumber,
        bhfNumber: providerDefaults?.bhfNumber || base.provider.bhfNumber,
        groupPracticeNumber: providerDefaults?.groupPracticeNumber || base.provider.groupPracticeNumber,
      },
    };
  };

  React.useEffect(() => {
    if (!patient?.id) return;
    setSubmitPayload((prev) => applyPatientToClaim(prev));
    setReversalPayload((prev) => applyPatientToClaim(prev));
  }, [patient?.id]);

  React.useEffect(() => {
    setClaimEligibilityResult(null);
  }, [
    submitPayload.patient.memberNumber,
    submitPayload.patient.dependantCode,
    submitPayload.patient.idNumber,
    submitPayload.patient.planCode,
    submitPayload.patient.firstName,
    submitPayload.patient.lastName,
    submitPayload.patient.initials,
    submitPayload.patient.dateOfBirth,
    submitPayload.provider.practiceNumber,
    submitPayload.provider.bhfNumber,
    submitPayload.provider.groupPracticeNumber,
    submitPayload.lineItems.map((li) => li.serviceDate).join('|'),
    patient?.schemeCode,
    userSettings?.billing?.schemeCode,
  ]);

  const canSubmit = useMemo(() => {
    const hasPatient = submitPayload.patient.firstName.trim() && submitPayload.patient.lastName.trim();
    const hasMember = submitPayload.patient.memberNumber.trim();
    const hasPlan = submitPayload.patient.planCode?.trim();
    const hasProvider = submitPayload.provider.name.trim();
    const hasDx = submitPayload.diagnoses.some(d => d.code.trim());
    const hasLine = submitPayload.lineItems.some(li => li.procedureCode.trim() && !!li.serviceDate);
    return !!(hasPatient && hasMember && hasPlan && hasProvider && hasDx && hasLine);
  }, [submitPayload]);

  const refreshClaims = async () => {
    setClaimsLoading(true);
    try {
      const data = await billingGetClaims({ limit: 50, offset: 0 });
      setClaims(data);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Failed to load claims.', 'error');
    } finally {
      setClaimsLoading(false);
    }
  };

  const refreshPatientClaims = async () => {
    if (!patient?.id) {
      setPatientClaims(null);
      return;
    }
    setPatientClaimsLoading(true);
    try {
      const res = await fetchPatientBillingClaims(patient.id);
      setPatientClaims(res.claims || []);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Failed to load patient claim history.', 'error');
    } finally {
      setPatientClaimsLoading(false);
    }
  };

  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await refreshClaims();
    };

    tick();

    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = window.setInterval(() => {
      tick().catch(() => {});
    }, 12_000);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    refreshPatientClaims().catch(() => {});
  }, [patient?.id]);

  React.useEffect(() => {
    writeJson(LS_HIDDEN_CLAIM_IDS, hiddenClaimIds);
  }, [hiddenClaimIds]);

  const visibleClaims = useMemo(
    () => (claims || []).filter((c) => !hiddenClaimIds.includes(c.id)),
    [claims, hiddenClaimIds]
  );

  const selectAndLoadClaim = async (id: string) => {
    if (expandedClaimId === id) {
      setExpandedClaimId(null);
      return;
    }
    setExpandedClaimId(id);
    const alreadyLoaded = selectedClaim?.id === id;
    if (alreadyLoaded) return;
    setDetailLoading(true);
    const reqId = ++claimDetailReqIdRef.current;
    try {
      const data = await billingGetClaimById(id.trim());
      if (reqId !== claimDetailReqIdRef.current) return;
      setSelectedClaim(data);
    } catch (e) {
      if (reqId !== claimDetailReqIdRef.current) return;
      onToast(e instanceof Error ? e.message : 'Failed to load claim.', 'error');
    } finally {
      if (reqId === claimDetailReqIdRef.current) setDetailLoading(false);
    }
  };

  const renderClaimDetails = (claim: StoredClaimRecord) => (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <p><span className="font-semibold text-slate-600">Patient:</span> {claim.patientFirstName || '—'} {claim.patientLastName || '—'}</p>
        <p><span className="font-semibold text-slate-600">Member:</span> {claim.memberNumber || '—'}</p>
        <p><span className="font-semibold text-slate-600">Dependant:</span> {claim.dependantCode || '—'}</p>
        <p><span className="font-semibold text-slate-600">Transaction:</span> {claim.transactionNumber || '—'}</p>
        <p><span className="font-semibold text-slate-600">Status:</span> {claim.reversed ? 'reversed' : claim.status}</p>
        <p><span className="font-semibold text-slate-600">Created:</span> {new Date(claim.createdAt).toLocaleString()}</p>
        <p><span className="font-semibold text-slate-600">Claimed:</span> {formatMoneyOrDash(claim.totalClaimedCents)}</p>
        <p><span className="font-semibold text-slate-600">Paid:</span> {formatMoneyOrDash(claim.totalPaidCents)}</p>
      </div>
      {claim.messages?.length ? (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Response messages</p>
          <ul className="mt-1 list-disc pl-4">
            {claim.messages.map((msg, idx) => (
              <li key={`${msg}-${idx}`}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {renderLineItemsSummary(claim)}
    </div>
  );

  const asObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

  const asString = (value: unknown): string =>
    typeof value === 'string' ? value : '';

  const asNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };

  const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

  const recentPatientClaims = useMemo(
    () => ((patientClaims || []).slice(-20).reverse()),
    [patientClaims]
  );

  const renderPatientHistoryRecord = (entry: unknown, idx: number) => {
    const row = asObject(entry);
    const request = asObject(row?.claimRequest);
    const result = asObject(row?.claimResult);
    const requestPatient = asObject(request?.patient);
    const requestLineItems = Array.isArray(request?.lineItems) ? request?.lineItems : [];

    const transactionNumber = asString(result?.transactionNumber) || asString(row?.transactionNumber);
    const status = asString(result?.status) || asString(row?.status) || 'unknown';
    const savedAt = asString(row?.savedAt) || asString(row?.createdAt);
    const memberNumber = asString(requestPatient?.memberNumber) || asString(row?.memberNumber);
    const dependantCode = asString(requestPatient?.dependantCode) || asString(row?.dependantCode);
    const planCode = asString(requestPatient?.planCode);
    const messages = asStringArray(result?.messages).concat(asStringArray(row?.messages));
    const patientFirstName = asString(requestPatient?.firstName) || asString(row?.patientFirstName);
    const patientLastName = asString(requestPatient?.lastName) || asString(row?.patientLastName);
    const claimedFromRow = asNumber(row?.totalClaimedCents);
    const paidFromRow = asNumber(row?.totalPaidCents);
    const lineItems = requestLineItems
      .map((item) => asObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const claimedFromLineItems = lineItems.reduce((sum, item) => sum + (asNumber(item.totalPriceCents) || 0), 0);
    const totalClaimedCents = typeof claimedFromRow === 'number' ? claimedFromRow : (claimedFromLineItems > 0 ? claimedFromLineItems : undefined);
    const key = `${savedAt || 'entry'}-${transactionNumber || status}-${idx}`;
    const isExpanded = expandedPatientHistoryKey === key;

    return (
      <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <button
          type="button"
          onClick={() => setExpandedPatientHistoryKey((prev) => (prev === key ? null : key))}
          className="w-full text-left"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">
              {transactionNumber || `Saved claim ${idx + 1}`}
            </p>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-600">
              {status}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Member: {memberNumber || '—'} • Dep: {dependantCode || '—'} • {savedAt ? new Date(savedAt).toLocaleString() : 'No timestamp'}
          </p>
        </button>
        {isExpanded ? (
          <div className="mt-3 space-y-2 text-xs text-slate-700">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <p><span className="font-semibold text-slate-600">Patient:</span> {[patientFirstName, patientLastName].filter(Boolean).join(' ') || '—'}</p>
              <p><span className="font-semibold text-slate-600">Member:</span> {memberNumber || '—'}</p>
              <p><span className="font-semibold text-slate-600">Dependant:</span> {dependantCode || '—'}</p>
              <p><span className="font-semibold text-slate-600">Transaction:</span> {transactionNumber || '—'}</p>
              <p><span className="font-semibold text-slate-600">Status:</span> {status}</p>
              <p><span className="font-semibold text-slate-600">Created:</span> {savedAt ? new Date(savedAt).toLocaleString() : '—'}</p>
              <p><span className="font-semibold text-slate-600">Claimed:</span> {formatMoneyOrDash(totalClaimedCents)}</p>
              <p><span className="font-semibold text-slate-600">Paid:</span> {formatMoneyOrDash(paidFromRow)}</p>
              <p><span className="font-semibold text-slate-600">Plan code:</span> {planCode || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Response messages</p>
              {messages.length > 0 ? (
                <ul className="mt-1 list-disc pl-4">
                  {messages.map((msg, messageIdx) => (
                    <li key={`${key}-msg-${messageIdx}`}>{msg}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-slate-500">No messages parsed from response.</p>
              )}
            </div>
            {lineItems.length > 0 ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Line items</p>
                <div className="mt-1 space-y-1.5">
                  {lineItems.map((li, liIdx) => (
                    <div key={`${key}-li-${liIdx}`} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                      <p className="text-xs font-semibold text-slate-700">
                        {asString(li.procedureCode) || '—'} {asString(li.description) ? `— ${asString(li.description)}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Qty {Number(li.quantity ?? 0) || 0} • {asString(li.serviceDate) || 'No date'}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const hideClaimFromList = (claimId: string) => {
    setHiddenClaimIds((prev) => (prev.includes(claimId) ? prev : [...prev, claimId]));
    if (selectedClaim?.id === claimId) {
      setSelectedClaim(null);
    }
    onToast('Claim removed from this list view.', 'info');
  };

  const buildEligibilityFromClaim = (claimPayload: BillingClaimCreatePayload): BillingEligibilityPayload => {
    const name = splitName(`${claimPayload.patient.firstName} ${claimPayload.patient.lastName}`.trim() || patient?.name || '');
    const firstServiceDate = claimPayload.lineItems.find((li) => li.serviceDate)?.serviceDate || getTodayIsoDate();
    const resolvedPlanCode =
      claimPayload.patient.planCode ||
      patient?.planCode ||
      patient?.medicalAidPlan ||
      userSettings?.billing?.planCode ||
      '';
    const resolvedSchemeCode =
      patient?.schemeCode ||
      userSettings?.billing?.schemeCode ||
      resolvedPlanCode;
    const resolvedMemberNumber =
      claimPayload.patient.memberNumber ||
      patient?.memberNumber ||
      patient?.medicalAidNumber ||
      '';
    const resolvedPatientId =
      claimPayload.patient.idNumber ||
      patient?.idNumber ||
      '';

    return {
      requestType: 'normal',
      memberNumber: resolvedMemberNumber,
      dependantCode: claimPayload.patient.dependantCode || patient?.dependantCode || '',
      patientDateOfBirth: claimPayload.patient.dateOfBirth || '',
      patientIdNumber: resolvedPatientId,
      patientFirstName: toUpperOrEmpty(claimPayload.patient.firstName || name.firstName),
      patientLastName: toUpperOrEmpty(claimPayload.patient.lastName || name.lastName),
      patientInitials: claimPayload.patient.initials || toInitials(name.firstName, name.lastName),
      serviceDate: firstServiceDate,
      schemeCode: resolvedSchemeCode,
      planCode: resolvedPlanCode,
      providerPracticeNumber: claimPayload.provider.practiceNumber || userSettings?.billing?.provider?.practiceNumber || '',
      bhfNumber: claimPayload.provider.bhfNumber || userSettings?.billing?.provider?.bhfNumber || '',
      groupPracticeNumber: claimPayload.provider.groupPracticeNumber || userSettings?.billing?.provider?.groupPracticeNumber || '',
    };
  };

  const checkEligibilityForClaim = async () => {
    const requestPayload = compactEligibilityPayload(buildEligibilityFromClaim(submitPayload));
    const hasMemberOrId = !!(requestPayload.memberNumber ?? '').trim() || !!requestPayload.patientIdNumber?.trim();
    if (!requestPayload.serviceDate || !requestPayload.schemeCode?.trim() || !requestPayload.planCode?.trim() || !hasMemberOrId) {
      onToast('Eligibility needs service date, scheme code, plan code, and either member number or patient ID number.', 'error');
      return;
    }
    setClaimEligibilityLoading(true);
    setClaimEligibilityResult(null);
    try {
      const res = await billingCheckEligibility(requestPayload);
      setClaimEligibilityResult(res);
      onToast(`Eligibility: ${res.status}.`, res.status === 'eligible' ? 'success' : 'info');
      writeJson(LS_LAST_ELIGIBILITY, requestPayload);
      if (patient?.id) {
        await appendPatientBillingEligibility(patient.id, {
          savedAt: new Date().toISOString(),
          patientId: patient.id,
          eligibilityRequest: requestPayload,
          eligibilityResult: res,
        });
      }
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Eligibility check failed.', 'error');
    } finally {
      setClaimEligibilityLoading(false);
    }
  };

  const submitClaim = async () => {
    if (!claimEligibilityResult) {
      onToast('Please run eligibility check before submitting the claim.', 'info');
      return;
    }
    if (claimEligibilityResult.status === 'ineligible') {
      onToast('Patient is ineligible. Resolve the eligibility issue before claim submission.', 'error');
      return;
    }
    try {
      const payloadToSubmit = compactClaimPayload(submitPayload);
      const result = await billingSubmitClaim(payloadToSubmit);
      onToast(`Claim ${result.status}.`, result.status === 'accepted' ? 'success' : 'info');
      writeJson(LS_LAST_SUBMIT, payloadToSubmit);
      if (result.transactionNumber) {
        const existing = readJson<Record<string, BillingClaimCreatePayload>>(LS_SUBMITTED_BY_TX) || {};
        existing[result.transactionNumber] = payloadToSubmit;
        writeJson(LS_SUBMITTED_BY_TX, existing);
      }

      if (patient?.id) {
        await appendPatientBillingClaim(patient.id, {
          savedAt: new Date().toISOString(),
          patientId: patient.id,
          claimRequest: payloadToSubmit,
          claimResult: result,
        });
        await refreshPatientClaims();
      }

      await refreshClaims();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Failed to submit claim.', 'error');
    }
  };

  const reverseClaim = async () => {
    if (!reversalTx.trim()) {
      onToast('Transaction number is required for reversal.', 'error');
      return;
    }
    try {
      const payloadToSubmit = compactClaimPayload(reversalPayload);
      const result = await billingReverseClaim({ ...payloadToSubmit, transactionNumber: reversalTx.trim() });
      onToast(`Reversal ${result.status}.`, result.status === 'accepted' ? 'success' : 'info');
      await refreshClaims();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Failed to reverse claim.', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Claims"
        subtitle="Work with billing claims: list, submit, and reverse."
        right={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
              {(['list', 'submit', 'reverse'] as ClaimsSubTab[]).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSubTab(name)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full transition ${
                    subTab === name ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {name[0].toUpperCase() + name.slice(1)}
                </button>
              ))}
            </div>
            {claimsLoading ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
                <RefreshCw size={14} className="animate-spin" />
                Updating…
              </span>
            ) : null}
          </div>
        }
      >
        {subTab === 'list' && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent claims</p>
              {detailLoading ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <RefreshCw size={14} className="animate-spin" />
                  Loading details…
                </span>
              ) : null}
            </div>
            {claims === null ? (
              <p className="text-sm text-slate-500">Loading claims…</p>
            ) : visibleClaims.length === 0 ? (
              <p className="text-sm text-slate-500">No claims found.</p>
            ) : (
              <div className="space-y-2">
                {visibleClaims.map(c => {
                  const isExpanded = expandedClaimId === c.id;
                  const claimForDetails = selectedClaim?.id === c.id ? selectedClaim : c;
                  return (
                    <div key={c.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => selectAndLoadClaim(c.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="truncate text-sm font-semibold text-slate-800">{c.patientLastName || '—'}</p>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            Member: {c.memberNumber} • Tx: {c.transactionNumber || '—'} • Items:{' '}
                            {c.totalLineItems ?? c.lineItemsSummary?.length ?? '—'}
                          </p>
                        </button>
                        <div className="flex items-center gap-2">
                          <span
                            className={`shrink-0 rounded-full border bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                              c.reversed ? 'border-rose-200 text-rose-700' : 'border-slate-200 text-slate-500'
                            }`}
                          >
                            {c.reversed ? 'reversed' : c.status}
                          </span>
                          <button
                            type="button"
                            onClick={() => hideClaimFromList(c.id)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                            title="Remove claim from this list"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      {isExpanded ? renderClaimDetails(claimForDetails) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {subTab === 'list' && patient?.id && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Patient claim history</p>
                <p className="text-sm font-semibold text-slate-800">
                  {formatPatientDisplayName(patient, patientNaming)}
                </p>
              </div>
              {patientClaimsLoading ? (
                <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <RefreshCw size={14} className="animate-spin" />
                  Loading…
                </span>
              ) : null}
            </div>
            <div className="mt-3">
              {patientClaims === null ? (
                <p className="text-sm text-slate-500">Select a patient to see saved claim history.</p>
              ) : patientClaims.length === 0 ? (
                <p className="text-sm text-slate-500">No saved claims for this patient yet.</p>
              ) : (
                <div className="space-y-2">
                  {recentPatientClaims.map((entry, idx) => renderPatientHistoryRecord(entry, idx))}
                </div>
              )}
            </div>
          </div>
        )}

        {subTab === 'submit' && (
          <div className="mt-1">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Submit new claim</p>
            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Eligibility check</p>
                  <p className="text-sm text-slate-600">
                    Check member eligibility for the current claim details before submission.
                  </p>
                </div>
                <SmallButton onClick={checkEligibilityForClaim} disabled={claimEligibilityLoading}>
                  {claimEligibilityLoading ? <RefreshCw size={16} className="animate-spin" /> : null}
                  Check eligibility
                </SmallButton>
              </div>
              <div className="mt-3">
                {claimEligibilityResult ? (
                  <div
                    className={`rounded-xl border px-3 py-2 text-sm ${
                      claimEligibilityResult.status === 'eligible'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : claimEligibilityResult.status === 'ineligible'
                          ? 'border-rose-200 bg-rose-50 text-rose-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    <p className="font-semibold">Status: {claimEligibilityResult.status}</p>
                    {claimEligibilityResult.messages?.length ? (
                      <ul className="mt-1 list-disc pl-5">
                        {claimEligibilityResult.messages.map((msg, idx) => (
                          <li key={`${msg}-${idx}`}>{msg}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No eligibility result yet. Run a check first.</p>
                )}
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <SmallButton
                onClick={() => {
                  if (!patient) {
                    onToast('Select a patient first to autofill.', 'info');
                    return;
                  }
                  setSubmitPayload((prev) => applyPatientToClaim(prev));
                  onToast('Autofilled claim from patient billing fields.', 'success');
                }}
                variant="secondary"
              >
                Use patient billing
              </SmallButton>
              <SmallButton
                onClick={() => {
                  const saved = readJson<BillingClaimCreatePayload>(LS_LAST_SUBMIT);
                  if (saved) {
                    setSubmitPayload(saved);
                    onToast('Autofilled from last submitted claim.', 'success');
                  } else {
                    onToast('No saved claim found yet. Submit a claim once to enable autofill.', 'info');
                  }
                }}
                variant="secondary"
              >
                Use last claim
              </SmallButton>
              <SmallButton
                onClick={() => {
                  setSubmitPayload(getEmptyClaimPayload());
                  onToast('Cleared claim form.', 'info');
                }}
                variant="secondary"
              >
                Clear
              </SmallButton>
            </div>
            <ClaimForm
              payload={submitPayload}
              onChange={setSubmitPayload}
              actionLabel="Submit claim"
              onAction={submitClaim}
              actionDisabled={!canSubmit || claimEligibilityLoading}
            />
          </div>
        )}

        {subTab === 'reverse' && (
          <div className="mt-1 space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="md:col-span-2">
                <Label>Select claim to reverse</Label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                  value={reversalTx}
                  onChange={e => setReversalTx(e.target.value)}
                >
                  <option value="">Select a claim…</option>
                  {visibleClaims.map(c =>
                    c.transactionNumber ? (
                      <option key={c.id} value={c.transactionNumber}>
                        {c.transactionNumber} — {c.patientLastName || ''} ({c.memberNumber})
                      </option>
                    ) : null
                  )}
                </select>
              </div>
              <div>
                <Label>Transaction number</Label>
                <Input value={reversalTx} onChange={e => setReversalTx(e.target.value)} placeholder="e.g. TX123456789" />
              </div>
            </div>
            <ClaimForm
              payload={reversalPayload}
              onChange={setReversalPayload}
              actionLabel="Reverse claim"
              onAction={reverseClaim}
              actionVariant="danger"
            />
          </div>
        )}
      </Section>
    </div>
  );
}

function ClaimForm({
  payload,
  onChange,
  actionLabel,
  onAction,
  actionDisabled,
  actionVariant = 'primary',
}: {
  payload: BillingClaimCreatePayload;
  onChange: (p: BillingClaimCreatePayload) => void;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  actionVariant?: 'primary' | 'secondary' | 'danger';
}) {
  const diagnosisOptionValue = (code: string, description?: string) => `${code}||${description || ''}`;
  const lineItemOptionValue = (procedureCode: string, description?: string) => `${procedureCode}||${description || ''}`;

  const findDiagnosisPresetValue = (item: BillingClaimCreatePayload['diagnoses'][number]) => {
    const exact = MEDIKREDIT_DIAGNOSIS_OPTIONS.find(
      (opt) => opt.code === item.code && (opt.description || '') === (item.description || '')
    );
    if (exact) return diagnosisOptionValue(exact.code, exact.description);
    const byCode = MEDIKREDIT_DIAGNOSIS_OPTIONS.find((opt) => opt.code === item.code);
    return byCode ? diagnosisOptionValue(byCode.code, byCode.description) : '';
  };

  const findLineItemPresetValue = (item: BillingClaimCreatePayload['lineItems'][number]) => {
    const exact = MEDIKREDIT_LINE_ITEM_OPTIONS.find(
      (opt) => opt.procedureCode === item.procedureCode && (opt.description || '') === (item.description || '')
    );
    if (exact) return lineItemOptionValue(exact.procedureCode, exact.description);
    const byCode = MEDIKREDIT_LINE_ITEM_OPTIONS.find((opt) => opt.procedureCode === item.procedureCode);
    return byCode ? lineItemOptionValue(byCode.procedureCode, byCode.description) : '';
  };

  const updatePatient = (patch: Partial<BillingClaimCreatePayload['patient']>) =>
    onChange({ ...payload, patient: { ...payload.patient, ...patch } });
  const updateProvider = (patch: Partial<BillingClaimCreatePayload['provider']>) =>
    onChange({ ...payload, provider: { ...payload.provider, ...patch } });

  const updateDiagnosis = (idx: number, patch: Partial<BillingClaimCreatePayload['diagnoses'][number]>) => {
    const diagnoses = payload.diagnoses.map((d, i) => (i === idx ? { ...d, ...patch } : d));
    onChange({ ...payload, diagnoses });
  };
  const addDiagnosis = () => onChange({ ...payload, diagnoses: [...payload.diagnoses, { code: '', description: '' }] });
  const removeDiagnosis = (idx: number) => {
    const diagnoses = payload.diagnoses.filter((_, i) => i !== idx);
    onChange({ ...payload, diagnoses: diagnoses.length ? diagnoses : [{ code: '', description: '' }] });
  };

  const updateLineItem = (idx: number, patch: Partial<BillingClaimCreatePayload['lineItems'][number]>) => {
    const lineItems = payload.lineItems.map((li, i) => (i === idx ? { ...li, ...patch } : li));
    onChange({ ...payload, lineItems });
  };
  const addLineItem = () =>
    onChange({
      ...payload,
      lineItems: [
        ...payload.lineItems,
        {
          procedureCode: '',
          description: '',
          quantity: 1,
          unitPriceCents: 0,
          totalPriceCents: 0,
          serviceDate: getTodayIsoDate(),
        },
      ],
    });
  const removeLineItem = (idx: number) => {
    const lineItems = payload.lineItems.filter((_, i) => i !== idx);
    onChange({
      ...payload,
      lineItems: lineItems.length
        ? lineItems
        : [
            {
              procedureCode: '',
              description: '',
              quantity: 1,
              unitPriceCents: 0,
              totalPriceCents: 0,
              serviceDate: getTodayIsoDate(),
            },
          ],
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label>Patient first name</Label>
          <Input value={payload.patient.firstName} onChange={e => updatePatient({ firstName: e.target.value })} />
        </div>
        <div>
          <Label>Patient last name</Label>
          <Input value={payload.patient.lastName} onChange={e => updatePatient({ lastName: e.target.value })} />
        </div>
        <div>
          <Label>Date of birth</Label>
          <Input
            type="date"
            value={payload.patient.dateOfBirth}
            onChange={e => updatePatient({ dateOfBirth: e.target.value })}
          />
        </div>
        <div>
          <Label>Member number</Label>
          <Input value={payload.patient.memberNumber} onChange={e => updatePatient({ memberNumber: e.target.value })} />
        </div>
        <div>
          <Label>Plan code</Label>
          <Input value={payload.patient.planCode || ''} onChange={e => updatePatient({ planCode: e.target.value })} placeholder="e.g. 612346" />
        </div>
        <div>
          <Label>Dependant code</Label>
          <Input value={payload.patient.dependantCode || ''} onChange={e => updatePatient({ dependantCode: e.target.value })} placeholder="e.g. 01" />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Provider</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <Label>Provider name</Label>
            <Input value={payload.provider.name} onChange={e => updateProvider({ name: e.target.value })} />
          </div>
          <div>
            <Label>Practice number</Label>
            <Input value={payload.provider.practiceNumber || ''} onChange={e => updateProvider({ practiceNumber: e.target.value })} />
          </div>
          <div>
            <Label>HPC number</Label>
            <Input value={payload.provider.hpcNumber || ''} onChange={e => updateProvider({ hpcNumber: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Diagnoses</p>
          <SmallButton onClick={addDiagnosis} variant="secondary">
            Add diagnosis
          </SmallButton>
        </div>
        <div className="mt-3 space-y-3">
          {payload.diagnoses.map((d, idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label>Diagnosis preset</Label>
                  <select
                    value={findDiagnosisPresetValue(d)}
                    onChange={e => {
                      const value = e.target.value;
                      if (!value) return;
                      const [code, description] = value.split('||');
                      updateDiagnosis(idx, { code, description });
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  >
                    <option value="">Select diagnosis preset…</option>
                    {MEDIKREDIT_DIAGNOSIS_OPTIONS.map((opt) => (
                      <option key={diagnosisOptionValue(opt.code, opt.description)} value={diagnosisOptionValue(opt.code, opt.description)}>
                        {opt.code} — {opt.description}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Code</Label>
                  <Input value={d.code} onChange={e => updateDiagnosis(idx, { code: e.target.value })} placeholder="e.g. J06.9" />
                </div>
                <div>
                  <Label>Description</Label>
                  <Input value={d.description || ''} onChange={e => updateDiagnosis(idx, { description: e.target.value })} />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <SmallButton onClick={() => removeDiagnosis(idx)} variant="danger" disabled={payload.diagnoses.length <= 1}>
                  Remove
                </SmallButton>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Line items</p>
          <SmallButton onClick={addLineItem} variant="secondary">
            Add line item
          </SmallButton>
        </div>
        <div className="mt-3 space-y-3">
          {payload.lineItems.map((li, idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <Label>Line item preset</Label>
                  <select
                    value={findLineItemPresetValue(li)}
                    onChange={e => {
                      const value = e.target.value;
                      if (!value) return;
                      const [procedureCode, description] = value.split('||');
                      const option = MEDIKREDIT_LINE_ITEM_OPTIONS.find(
                        (opt) => opt.procedureCode === procedureCode && (opt.description || '') === (description || '')
                      );
                      if (!option) return;
                      updateLineItem(idx, {
                        procedureCode: option.procedureCode,
                        description: option.description,
                        quantity: option.quantity,
                        unitPriceCents: option.unitPriceCents,
                        totalPriceCents: option.totalPriceCents,
                      });
                    }}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100"
                  >
                    <option value="">Select line item preset…</option>
                    {MEDIKREDIT_LINE_ITEM_OPTIONS.map((opt) => (
                      <option key={lineItemOptionValue(opt.procedureCode, opt.description)} value={lineItemOptionValue(opt.procedureCode, opt.description)}>
                        {opt.procedureCode} — {opt.description} ({formatCents(opt.totalPriceCents)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Procedure code</Label>
                  <Input value={li.procedureCode} onChange={e => updateLineItem(idx, { procedureCode: e.target.value })} />
                </div>
                <div>
                  <Label>Service date</Label>
                  <Input type="date" value={li.serviceDate} onChange={e => updateLineItem(idx, { serviceDate: e.target.value })} />
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min={0}
                    value={li.quantity}
                    onChange={e => updateLineItem(idx, { quantity: Number(e.target.value || 0) })}
                  />
                </div>
                <div>
                  <Label>Total price (cents)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={li.totalPriceCents}
                    onChange={e => updateLineItem(idx, { totalPriceCents: Number(e.target.value || 0) })}
                  />
                  <p className="mt-1 text-xs text-slate-400">{formatCents(li.totalPriceCents)}</p>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <SmallButton onClick={() => removeLineItem(idx)} variant="danger" disabled={payload.lineItems.length <= 1}>
                  Remove
                </SmallButton>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <SmallButton onClick={onAction} disabled={actionDisabled} variant={actionVariant}>
          {actionLabel}
        </SmallButton>
      </div>
    </div>
  );
}

