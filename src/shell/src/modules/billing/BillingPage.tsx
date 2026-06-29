import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  billingGetClaims,
  billingGetClaimById,
  billingCheckEligibility,
  billingSubmitClaim,
  billingReverseClaim,
  formatBillingError,
  ELIGIBILITY_REQUEST_TYPE_OPTIONS,
  eligibilityRequiresMemberNumber,
  normalizeEligibilityRequestType,
  formatClaimStatusLabel,
  isClaimStatusBillable,
  claimStatusBadgeClass,
  resolveBillableCents,
  type BillingClaimCreatePayload,
  type BillingEligibilityPayload,
  type ClaimLineItemResultDto,
  type ClaimResultDto,
  type EligibilityRequestType,
  type EligibilityResponseDto,
  dependantCodesEqual,
  type FamilyMemberDto,
  type FamilyMemberInquiryMatchDto,
  parseStoredFamilyMembers,
  parseStoredInquiryMatch,
  parseStoredLineItemResults,
  type StoredClaimRecord,
} from './services/billingApi';
import {
  MEDIKREDIT_DIAGNOSIS_OPTIONS,
  MEDIKREDIT_LINE_ITEM_OPTIONS,
} from './services/claimOptions';
import type { Patient, UserSettings } from '../../../../../shared/types';
import {
  appendPatientBillingClaim,
  appendPatientBillingEligibility,
  fetchPatientBillingClaims,
  fetchPatientBillingEligibility,
} from './services/api';

type ToastFn = (message: string, type?: 'success' | 'error' | 'info') => void;

type ClaimsSubTab = 'list' | 'submit' | 'reverse' | 'financials';

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

function BillingErrorAlert({
  title,
  message,
  onDismiss,
}: {
  title: string;
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-950 shadow-sm"
      role="alert"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-rose-700">{title}</p>
          <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{message}</p>
        </div>
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 rounded-lg border border-rose-200 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ClaimLineItemResultsPanel({ results }: { results: ClaimLineItemResultDto[] }) {
  if (!results.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Line item outcomes</p>
      <div className="mt-2 space-y-2">
        {results.map((li) => (
          <div
            key={li.lineNumber}
            className={`rounded-lg border px-3 py-2 text-xs ${
              li.billable
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-rose-200 bg-rose-50 text-rose-900'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">
                Line {li.lineNumber}
                {li.procedureCode ? ` · ${li.procedureCode}` : ''}
                {li.nappiCode ? ` · NAPPI ${li.nappiCode}` : ''}
              </span>
              <span className="font-bold uppercase tracking-wide">
                {li.billable ? 'billable' : 'not billable'}
              </span>
            </div>
            {(li.grossCents != null || li.nettCents != null) && (
              <p className="mt-1 text-slate-600">
                {typeof li.nettCents === 'number'
                  ? formatCents(li.nettCents)
                  : typeof li.grossCents === 'number'
                    ? formatCents(li.grossCents)
                    : ''}
              </p>
            )}
            {li.messages?.length ? (
              <ul className="mt-1 list-disc pl-4">
                {li.messages.map((m, idx) => (
                  <li key={`${li.lineNumber}-${idx}`}>
                    {m.code ? `${m.type} ${m.code}: ` : `${m.type}: `}
                    {m.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ClaimSubmitResultPanel({ result }: { result: ClaimResultDto }) {
  const billable = resolveBillableCents(result);
  const lineResults = result.lineItemResults ?? [];
  return (
    <div className="mt-4 rounded-2xl border border-cyan-200 bg-cyan-50/50 p-4">
      <p className="text-xs font-bold uppercase tracking-wider text-cyan-800">Last claim response</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`rounded-full border bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${claimStatusBadgeClass(result.status)}`}
        >
          {formatClaimStatusLabel(result.status)}
        </span>
        {result.transactionNumber ? (
          <span className="text-slate-700">
            Tx <span className="font-mono font-semibold">{result.transactionNumber}</span>
          </span>
        ) : null}
        {typeof billable === 'number' ? (
          <span className="text-slate-700">
            Billable <span className="font-semibold">{formatCents(billable)}</span>
          </span>
        ) : null}
      </div>
      {result.hnet ? (
        <p className="mt-2 text-xs text-slate-700">
          <span className="font-semibold">HNET:</span> {result.hnet}
        </p>
      ) : null}
      {result.planCode ? (
        <p className="mt-1 text-xs text-slate-700">
          <span className="font-semibold">Plan:</span> {result.planCode}
        </p>
      ) : null}
      {lineResults.length ? <ClaimLineItemResultsPanel results={lineResults} /> : null}
      {result.messages?.length ? (
        <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
          {result.messages.map((msg, idx) => (
            <li key={`submit-msg-${idx}`}>{msg}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function VerifiedPatientPanel({ patient }: { patient: FamilyMemberDto }) {
  return (
    <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/80 p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-sky-800">Confirmed on scheme</p>
      <p className="mt-1 text-sm font-semibold text-slate-800">
        Dep {patient.dependantCode}
        {[patient.firstName, patient.lastName].filter(Boolean).join(' ') || '—'}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        {patient.dateOfBirth ? `DOB ${patient.dateOfBirth}` : ''}
        {patient.idNumber ? ` · ID ${patient.idNumber}` : ''}
      </p>
    </div>
  );
}

function FamilyMembersPanel({
  members,
  inquiryDependantCode,
  inquiryMatch,
  onApplyMember,
}: {
  members: FamilyMemberDto[];
  inquiryDependantCode?: string;
  inquiryMatch?: FamilyMemberInquiryMatchDto;
  onApplyMember?: (member: FamilyMemberDto) => void;
}) {
  if (!members.length) return null;
  const inquiryDep = (inquiryDependantCode ?? '').trim();
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Family members (FAMCHECK)</p>
      {inquiryDep ? (
        <p className="mt-1 text-xs text-slate-600">
          You checked dependant <span className="font-semibold">{inquiryDep}</span>
          {inquiryMatch?.matched && inquiryMatch.member ? (
            <>
              {' '}
              — matched roster dep <span className="font-semibold">{inquiryMatch.member.dependantCode}</span>
              {inquiryMatch.matchReason ? ` (${inquiryMatch.matchReason})` : ''}
            </>
          ) : (
            <span className="text-amber-800"> — no roster match; use ID or name to pick the right dependant.</span>
          )}
        </p>
      ) : null}
      <div className="mt-2 space-y-2">
        {members.map((m) => {
          const isMatch = inquiryMatch?.matched && inquiryMatch.member?.dependantCode === m.dependantCode;
          const depMismatch =
            inquiryDep &&
            inquiryMatch?.matched &&
            inquiryMatch.member?.dependantCode === m.dependantCode &&
            !dependantCodesEqual(inquiryDep, m.dependantCode);
          return (
            <div
              key={`${m.dependantCode}-${m.idNumber ?? ''}`}
              className={`rounded-lg border px-3 py-2 text-xs ${
                isMatch
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : 'border-slate-100 bg-slate-50 text-slate-700'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-semibold text-slate-800">
                  Dep {m.dependantCode}
                  {[m.firstName, m.lastName].filter(Boolean).join(' ') || '—'}
                  {isMatch ? (
                    <span className="ml-2 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-800">
                      Match
                    </span>
                  ) : null}
                </p>
                {onApplyMember ? (
                  <button
                    type="button"
                    onClick={() => onApplyMember(m)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600 hover:border-cyan-300 hover:text-cyan-800"
                  >
                    Use on claim
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-slate-500">
                {m.dateOfBirth ? `DOB ${m.dateOfBirth}` : ''}
                {m.idNumber ? ` · ID ${m.idNumber}` : ''}
                {m.plan?.joinDate ? ` · Joined ${m.plan.joinDate}` : ''}
              </p>
              {depMismatch ? (
                <p className="mt-1 text-amber-800">
                  Scheme uses dep {m.dependantCode} (you entered {inquiryDep}) — claim fields were updated.
                </p>
              ) : null}
              {m.statusDescription ? (
                <p className="mt-1 font-medium text-amber-800">{m.statusDescription}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getEmptyClaimPayload(): BillingClaimCreatePayload {
  return {
    hnet: '',
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
        nappiCode: '',
        description: '',
        quantity: 1,
        baseTariffCents: 0,
        tariffPercent: 100,
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
}: {
  onToast: ToastFn;
  patients: Patient[];
  selectedPatientId: string | null;
  userSettings: UserSettings | null;
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
                      {p.name} ({p.dob})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </header>

        <ClaimsTab onToast={onToast} patient={effectivePatient} userSettings={userSettings} />
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

function clampTariffPercent(value: number): number {
  if (!Number.isFinite(value)) return 100;
  if (value < 1) return 1;
  if (value > 300) return 300;
  return Math.round(value);
}

function recalcLineItemFromTariff(
  item: BillingClaimCreatePayload['lineItems'][number],
): BillingClaimCreatePayload['lineItems'][number] {
  const baseFromInput = Number(item.baseTariffCents ?? 0);
  const percent = clampTariffPercent(Number(item.tariffPercent ?? 100));
  const qty = Math.max(1, Math.round(Number(item.quantity || 1)));
  const fallbackBaseFromUnit = Math.max(0, Math.round(Number(item.unitPriceCents || 0)));
  const effectiveBase =
    Number.isFinite(baseFromInput) && baseFromInput > 0
      ? Math.round(baseFromInput)
      : fallbackBaseFromUnit;

  if (!Number.isFinite(effectiveBase) || effectiveBase <= 0) {
    return {
      ...item,
      quantity: qty,
      tariffPercent: percent,
      totalPriceCents: Math.max(0, Math.round(Number(item.totalPriceCents || 0))),
    };
  }

  const unitPriceCents = Math.round((effectiveBase * percent) / 100);
  return {
    ...item,
    baseTariffCents: effectiveBase,
    quantity: qty,
    tariffPercent: percent,
    unitPriceCents,
    totalPriceCents: unitPriceCents * qty,
  };
}

function toPercentOrDash(value?: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)}%`;
}

function computeCollectionRatePercent(
  claimedCents?: number,
  paidCents?: number,
): number | undefined {
  if (
    typeof claimedCents !== 'number' ||
    claimedCents <= 0 ||
    typeof paidCents !== 'number'
  ) {
    return undefined;
  }
  return (paidCents / claimedCents) * 100;
}

type ClaimFinancialSnapshot = {
  claimed?: number;
  paid?: number;
  outstanding?: number;
};

/** Amounts as stored on the claim (audit / pre-reversal). */
function claimOriginalFinancials(claim: StoredClaimRecord): ClaimFinancialSnapshot {
  const claimed = claim.totalClaimedCents;
  const paid = claim.totalPaidCents;
  const outstanding =
    typeof claim.varianceCents === 'number'
      ? claim.varianceCents
      : typeof claimed === 'number' && typeof paid === 'number'
        ? claimed - paid
        : typeof claimed === 'number'
          ? claimed
          : undefined;
  return { claimed, paid, outstanding };
}

/** Active billing position: R0 when reversed (voided at MediKredit). */
function claimEffectiveFinancials(claim: StoredClaimRecord): ClaimFinancialSnapshot {
  if (claim.reversed) {
    return { claimed: 0, paid: 0, outstanding: 0 };
  }
  return claimOriginalFinancials(claim);
}

function FinancialMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'warning';
}) {
  const toneClasses =
    tone === 'positive'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
      : tone === 'warning'
        ? 'bg-amber-50 border-amber-200 text-amber-800'
        : 'bg-white border-slate-200 text-slate-700';

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClasses}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  );
}

function ClaimFinancialsPanel({ claim }: { claim: StoredClaimRecord }) {
  const effective = claimEffectiveFinancials(claim);
  const original = claimOriginalFinancials(claim);
  const claimed = effective.claimed;
  const paid = effective.paid;
  const computedVariance = effective.outstanding;
  const collectionRate = computeCollectionRatePercent(claimed, paid);
  const averageLineValue =
    typeof claimed === 'number' &&
    typeof claim.totalLineItems === 'number' &&
    claim.totalLineItems > 0
      ? Math.round(claimed / claim.totalLineItems)
      : undefined;
  const originalAverageLineValue =
    claim.reversed &&
    typeof original.claimed === 'number' &&
    typeof claim.totalLineItems === 'number' &&
    claim.totalLineItems > 0
      ? Math.round(original.claimed / claim.totalLineItems)
      : undefined;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
        {claim.reversed ? 'Financials (active — voided)' : 'Financials'}
      </p>
      {claim.reversed ? (
        <p className="mt-1 text-xs text-rose-700">
          Reversed at MediKredit. Active claimed, paid, and outstanding are R0; original amounts are kept below for audit.
        </p>
      ) : null}
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
        <FinancialMetric label="Claimed amount" value={formatMoneyOrDash(claimed)} />
        <FinancialMetric label="Paid amount" value={formatMoneyOrDash(paid)} />
        <FinancialMetric
          label="Outstanding / variance"
          value={formatMoneyOrDash(computedVariance)}
          tone={typeof computedVariance === 'number' && computedVariance > 0 ? 'warning' : 'default'}
        />
        <FinancialMetric
          label="Collection rate"
          value={toPercentOrDash(collectionRate)}
          tone={typeof collectionRate === 'number' && collectionRate >= 95 ? 'positive' : 'default'}
        />
        <FinancialMetric
          label="Line items"
          value={String(claim.totalLineItems ?? claim.lineItemsSummary?.length ?? '—')}
        />
        <FinancialMetric
          label="Average line value"
          value={formatMoneyOrDash(averageLineValue)}
        />
        {typeof claim.billableCents === 'number' && !claim.reversed ? (
          <FinancialMetric
            label="Billable amount"
            value={formatMoneyOrDash(claim.billableCents)}
            tone="positive"
          />
        ) : null}
        {claim.hnet ? (
          <FinancialMetric label="HNET" value={claim.hnet} />
        ) : null}
        {claim.planCode ? (
          <FinancialMetric label="Plan" value={claim.planCode} />
        ) : null}
      </div>
      {claim.reversed ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Original (before reversal)
          </p>
          <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
            <FinancialMetric label="Claimed" value={formatMoneyOrDash(original.claimed)} />
            <FinancialMetric label="Paid" value={formatMoneyOrDash(original.paid)} />
            <FinancialMetric
              label="Outstanding"
              value={formatMoneyOrDash(original.outstanding)}
            />
            {typeof originalAverageLineValue === 'number' ? (
              <FinancialMetric
                label="Avg line value"
                value={formatMoneyOrDash(originalAverageLineValue)}
              />
            ) : null}
          </div>
        </div>
      ) : null}
      {claim.reversalStatus ? (
        <p className="mt-2 text-xs text-slate-600">
          Reversal status: <span className="font-semibold uppercase">{claim.reversalStatus}</span>
        </p>
      ) : null}
    </div>
  );
}

function PracticeFinancialsPanel({ claims }: { claims: StoredClaimRecord[] }) {
  const totalClaims = claims.length;
  const activeClaims = claims.filter((c) => !c.reversed);
  const acceptedClaims = activeClaims.filter((c) => c.status === 'accepted').length;
  const partiallyAcceptedClaims = activeClaims.filter(
    (c) => c.status === 'partially_accepted',
  ).length;
  const rejectedClaims = activeClaims.filter((c) => c.status === 'rejected').length;
  const pendingClaims = activeClaims.filter((c) => c.status === 'pending').length;
  const reversedClaims = claims.filter((c) => c.reversed).length;

  const claimedKnown = activeClaims.filter((c) => typeof claimEffectiveFinancials(c).claimed === 'number');
  const paidKnown = activeClaims.filter((c) => typeof claimEffectiveFinancials(c).paid === 'number');
  const withBoth = activeClaims.filter(
    (c) =>
      typeof claimEffectiveFinancials(c).claimed === 'number' &&
      typeof claimEffectiveFinancials(c).paid === 'number',
  );

  const totalClaimed = claimedKnown.reduce(
    (sum, c) => sum + (claimEffectiveFinancials(c).claimed || 0),
    0,
  );
  const totalPaid = paidKnown.reduce(
    (sum, c) => sum + (claimEffectiveFinancials(c).paid || 0),
    0,
  );
  const totalOutstanding = withBoth.reduce(
    (sum, c) => sum + (claimEffectiveFinancials(c).outstanding || 0),
    0,
  );

  const overallCollectionRate = computeCollectionRatePercent(totalClaimed, totalPaid);
  const avgClaimValue =
    claimedKnown.length > 0 ? Math.round(totalClaimed / claimedKnown.length) : undefined;

  const reversalRejected = claims.filter(
    (c) => c.reversalStatus?.toLowerCase() === 'rejected',
  ).length;

  const reversalRejectedRate =
    claims.filter((c) => !!c.reversalStatus).length > 0
      ? (reversalRejected / claims.filter((c) => !!c.reversalStatus).length) * 100
      : undefined;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Practice Financials
          </p>
          <p className="text-sm text-slate-600">
            Active totals across loaded claims. Reversed (voided) claims are excluded from claimed, paid, and
            outstanding sums.
          </p>
          {reversedClaims > 0 ? (
            <p className="mt-1 text-xs text-slate-500">
              {reversedClaims} reversed claim{reversedClaims === 1 ? '' : 's'} excluded from active totals.
            </p>
          ) : null}
        </div>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {activeClaims.length} active / {totalClaims} total
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <FinancialMetric label="Total claimed (active)" value={formatMoneyOrDash(totalClaimed)} />
        <FinancialMetric label="Total paid (active)" value={formatMoneyOrDash(totalPaid)} />
        <FinancialMetric
          label="Total outstanding (active)"
          value={formatMoneyOrDash(totalOutstanding)}
          tone={typeof totalOutstanding === 'number' && totalOutstanding > 0 ? 'warning' : 'default'}
        />
        <FinancialMetric
          label="Overall collection rate"
          value={toPercentOrDash(overallCollectionRate)}
          tone={
            typeof overallCollectionRate === 'number' && overallCollectionRate >= 95
              ? 'positive'
              : 'default'
          }
        />
        <FinancialMetric label="Average claim value" value={formatMoneyOrDash(avgClaimValue)} />
        <FinancialMetric
          label="Reversal reject rate"
          value={toPercentOrDash(reversalRejectedRate)}
          tone={
            typeof reversalRejectedRate === 'number' && reversalRejectedRate > 20
              ? 'warning'
              : 'default'
          }
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
        <FinancialMetric label="Accepted" value={String(acceptedClaims)} />
        <FinancialMetric label="Partial" value={String(partiallyAcceptedClaims)} />
        <FinancialMetric label="Rejected" value={String(rejectedClaims)} />
        <FinancialMetric label="Pending" value={String(pendingClaims)} />
        <FinancialMetric label="Reversed" value={String(reversedClaims)} />
        <FinancialMetric label="Reversal rejected" value={String(reversalRejected)} />
      </div>

      <PracticeClaimFinancialsList claims={claims} />
    </div>
  );
}

function PracticeClaimFinancialsList({ claims }: { claims: StoredClaimRecord[] }) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  if (claims.length === 0) {
    return (
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm text-slate-500">No claims available for financial breakdown.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
        Claim financials (detail)
      </p>
      <div className="hidden gap-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 md:grid md:grid-cols-6">
        <span className="md:col-span-2">Claim</span>
        <span>Active claimed</span>
        <span>Active paid</span>
        <span>Active outstanding</span>
        <span>Status</span>
      </div>
      <div className="space-y-2">
        {claims.map((claim) => {
          const effective = claimEffectiveFinancials(claim);
          const original = claimOriginalFinancials(claim);
          const claimed = effective.claimed;
          const paid = effective.paid;
          const outstanding = effective.outstanding;
          const isExpanded = expandedId === claim.id;

          return (
            <div
              key={claim.id}
              className={`rounded-xl border bg-white ${claim.reversed ? 'border-rose-200' : 'border-slate-200'}`}
            >
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : claim.id)}
                className="w-full px-3 py-2.5 text-left"
              >
                <div className="grid grid-cols-1 gap-2 md:grid-cols-6 md:items-center">
                  <div className="md:col-span-2 min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {claim.patientLastName || '—'}, {claim.patientFirstName || '—'}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      Tx {claim.transactionNumber || '—'} • {claim.memberNumber}
                    </p>
                    {claim.reversed &&
                    (typeof original.claimed === 'number' || typeof original.paid === 'number') ? (
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        Was {formatMoneyOrDash(original.claimed)} claimed
                        {typeof original.paid === 'number'
                          ? ` · ${formatMoneyOrDash(original.paid)} paid`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                  <p
                    className={`text-sm font-semibold ${claim.reversed ? 'text-rose-700' : 'text-slate-700'}`}
                  >
                    {formatMoneyOrDash(claimed)}
                  </p>
                  <p
                    className={`text-sm font-semibold ${claim.reversed ? 'text-rose-700' : 'text-slate-700'}`}
                  >
                    {formatMoneyOrDash(paid)}
                  </p>
                  <p
                    className={`text-sm font-semibold ${claim.reversed ? 'text-rose-700' : 'text-slate-700'}`}
                  >
                    {formatMoneyOrDash(outstanding)}
                  </p>
                  <p
                    className={`text-xs font-bold uppercase tracking-wider ${claim.reversed ? 'text-rose-700' : 'text-slate-500'}`}
                  >
                    {claim.reversed
                      ? 'reversed'
                      : formatClaimStatusLabel(claim.status)}
                    {claim.reversalStatus ? ` (${claim.reversalStatus})` : ''}
                  </p>
                </div>
              </button>
              {isExpanded ? (
                <div className="border-t border-slate-100 px-3 pb-3">
                  <ClaimFinancialsPanel claim={claim} />
                  {renderLineItemsSummary(claim)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
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
    hnet: trimOrUndefined(payload.hnet),
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
      nappiCode: trimOrUndefined(li.nappiCode),
      medicineQuantity:
        typeof li.medicineQuantity === 'number' && li.medicineQuantity > 0
          ? li.medicineQuantity
          : undefined,
      description: trimOrUndefined(li.description),
      baseTariffCents:
        typeof li.baseTariffCents === 'number' && li.baseTariffCents > 0
          ? Math.round(li.baseTariffCents)
          : undefined,
      tariffPercent:
        typeof li.tariffPercent === 'number' && li.tariffPercent > 0
          ? clampTariffPercent(li.tariffPercent)
          : undefined,
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
    requestType: normalizeEligibilityRequestType(compact(p.requestType)),
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
}: {
  onToast: ToastFn;
  patient?: Patient;
  userSettings: UserSettings | null;
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
  const [patientEligibilityChecks, setPatientEligibilityChecks] = useState<unknown[] | null>(null);
  const [patientEligibilityLoading, setPatientEligibilityLoading] = useState(false);
  const [lastClaimSubmitResult, setLastClaimSubmitResult] = useState<ClaimResultDto | null>(null);
  const [claimsMemberSearchInput, setClaimsMemberSearchInput] = useState('');
  const [claimsMemberFilter, setClaimsMemberFilter] = useState('');
  const [expandedPatientHistoryKey, setExpandedPatientHistoryKey] = useState<string | null>(null);
  const [hiddenClaimIds, setHiddenClaimIds] = useState<string[]>(
    () => readJson<string[]>(LS_HIDDEN_CLAIM_IDS) || []
  );

  const [submitPayload, setSubmitPayload] = useState<BillingClaimCreatePayload>(() => {
    const saved = readJson<BillingClaimCreatePayload>(LS_LAST_SUBMIT);
    return saved ?? getEmptyClaimPayload();
  });

  const [reversalTx, setReversalTx] = useState('');
  const [reversalLoading, setReversalLoading] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);
  const [selectedReversalClaim, setSelectedReversalClaim] = useState<StoredClaimRecord | null>(null);
  const [reversalPayload, setReversalPayload] = useState<BillingClaimCreatePayload>(() => {
    const saved = readJson<BillingClaimCreatePayload>(LS_LAST_SUBMIT);
    return saved ?? getEmptyClaimPayload();
  });
  const [claimEligibilityResult, setClaimEligibilityResult] = useState<EligibilityResponseDto | null>(null);
  const [claimEligibilityLoading, setClaimEligibilityLoading] = useState(false);
  const [eligibilityRequestType, setEligibilityRequestType] = useState<EligibilityRequestType>(() => {
    const saved = readJson<BillingEligibilityPayload>(LS_LAST_ELIGIBILITY);
    return normalizeEligibilityRequestType(saved?.requestType);
  });
  const [lastCheckedEligibilityType, setLastCheckedEligibilityType] = useState<EligibilityRequestType | null>(null);
  const [lastEligibilityInquiryDep, setLastEligibilityInquiryDep] = useState('');
  const selectedEligibilityOption =
    ELIGIBILITY_REQUEST_TYPE_OPTIONS.find((opt) => opt.value === eligibilityRequestType) ??
    ELIGIBILITY_REQUEST_TYPE_OPTIONS[0];

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
    setLastCheckedEligibilityType(null);
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
    eligibilityRequestType,
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

  const refreshClaims = async (memberNumberOverride?: string) => {
    setClaimsLoading(true);
    try {
      const member =
        memberNumberOverride !== undefined
          ? memberNumberOverride.trim()
          : claimsMemberFilter.trim();
      const data = await billingGetClaims({
        limit: 50,
        offset: 0,
        memberNumber: member || undefined,
      });
      setClaims(data);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Failed to load claims.', 'error');
    } finally {
      setClaimsLoading(false);
    }
  };

  const applyClaimsMemberSearch = () => {
    const trimmed = claimsMemberSearchInput.trim();
    setClaimsMemberFilter(trimmed);
    void refreshClaims(trimmed);
  };

  const clearClaimsMemberSearch = () => {
    setClaimsMemberSearchInput('');
    setClaimsMemberFilter('');
    void refreshClaims('');
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

  const refreshPatientEligibility = async () => {
    if (!patient?.id) {
      setPatientEligibilityChecks(null);
      return;
    }
    setPatientEligibilityLoading(true);
    try {
      const res = await fetchPatientBillingEligibility(patient.id);
      setPatientEligibilityChecks(res.checks || []);
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Failed to load patient eligibility history.', 'error');
    } finally {
      setPatientEligibilityLoading(false);
    }
  };

  const refreshPatientBillingHistory = async () => {
    await Promise.all([refreshPatientClaims(), refreshPatientEligibility()]);
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
  }, [claimsMemberFilter]);

  React.useEffect(() => {
    if (!patient?.id) {
      setPatientClaims(null);
      setPatientEligibilityChecks(null);
      return;
    }
    refreshPatientBillingHistory().catch(() => {});
  }, [patient?.id]);

  React.useEffect(() => {
    writeJson(LS_HIDDEN_CLAIM_IDS, hiddenClaimIds);
  }, [hiddenClaimIds]);

  const visibleClaims = useMemo(
    () => (claims || []).filter((c) => !hiddenClaimIds.includes(c.id)),
    [claims, hiddenClaimIds]
  );

  const reversalEligibleClaims = useMemo(
    () => visibleClaims.filter((c) => !c.reversed && !!c.transactionNumber),
    [visibleClaims]
  );

  useEffect(() => {
    if (!reversalTx.trim()) return;
    const stillEligible = reversalEligibleClaims.some((c) => c.transactionNumber === reversalTx.trim());
    if (!stillEligible) {
      setReversalTx('');
      setSelectedReversalClaim(null);
      setReversalError(null);
    }
  }, [reversalEligibleClaims, reversalTx]);

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
        <p><span className="font-semibold text-slate-600">HNET:</span> {claim.hnet || '—'}</p>
        <p><span className="font-semibold text-slate-600">Plan:</span> {claim.planCode || '—'}</p>
        <p>
          <span className="font-semibold text-slate-600">Status:</span>{' '}
          {claim.reversed ? 'reversed' : formatClaimStatusLabel(claim.status)}
        </p>
        {typeof claim.billableCents === 'number' && !claim.reversed ? (
          <p>
            <span className="font-semibold text-slate-600">Billable:</span>{' '}
            {formatMoneyOrDash(claim.billableCents)}
          </p>
        ) : null}
        {claim.reversed && claim.reversalStatus ? (
          <p><span className="font-semibold text-slate-600">Reversal:</span> {claim.reversalStatus}</p>
        ) : null}
        <p><span className="font-semibold text-slate-600">Created:</span> {new Date(claim.createdAt).toLocaleString()}</p>
        <p>
          <span className="font-semibold text-slate-600">Claimed (active):</span>{' '}
          {formatMoneyOrDash(claimEffectiveFinancials(claim).claimed)}
        </p>
        <p>
          <span className="font-semibold text-slate-600">Paid (active):</span>{' '}
          {formatMoneyOrDash(claimEffectiveFinancials(claim).paid)}
        </p>
        {claim.reversed ? (
          <>
            <p>
              <span className="font-semibold text-slate-600">Claimed (original):</span>{' '}
              {formatMoneyOrDash(claimOriginalFinancials(claim).claimed)}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Paid (original):</span>{' '}
              {formatMoneyOrDash(claimOriginalFinancials(claim).paid)}
            </p>
          </>
        ) : null}
      </div>
      <ClaimFinancialsPanel claim={claim} />
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
      {claim.reversed && claim.reversalMessages?.length ? (
        <div className="mt-3">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Reversal messages</p>
          <ul className="mt-1 list-disc pl-4">
            {claim.reversalMessages.map((msg, idx) => (
              <li key={`rev-${msg}-${idx}`}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {claim.lineItemResults?.length ? (
        <ClaimLineItemResultsPanel results={claim.lineItemResults} />
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

  const recentPatientEligibility = useMemo(
    () => ((patientEligibilityChecks || []).slice(-10).reverse()),
    [patientEligibilityChecks]
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
    const planCode =
      asString(result?.planCode) ||
      asString(requestPatient?.planCode);
    const hnet = asString(result?.hnet);
    const lineItemResults = parseStoredLineItemResults(result?.lineItemResults);
    const billableCents =
      asNumber(result?.billableCents) ?? resolveBillableCents({ lineItemResults });
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
    const key = `claim-${savedAt || 'entry'}-${transactionNumber || status}-${idx}`;
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
            <span
              className={`rounded-full border bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${claimStatusBadgeClass(status)}`}
            >
              {formatClaimStatusLabel(status)}
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
              <p><span className="font-semibold text-slate-600">HNET:</span> {hnet || '—'}</p>
              <p><span className="font-semibold text-slate-600">Plan code:</span> {planCode || '—'}</p>
              {typeof billableCents === 'number' ? (
                <p>
                  <span className="font-semibold text-slate-600">Billable:</span>{' '}
                  {formatMoneyOrDash(billableCents)}
                </p>
              ) : null}
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
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Requested line items</p>
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
            {lineItemResults.length > 0 ? (
              <ClaimLineItemResultsPanel results={lineItemResults} />
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  const renderPatientEligibilityHistoryRecord = (entry: unknown, idx: number) => {
    const row = asObject(entry);
    const request = asObject(row?.eligibilityRequest);
    const result = asObject(row?.eligibilityResult);
    const savedAt = asString(row?.savedAt) || asString(row?.createdAt);
    const requestType = normalizeEligibilityRequestType(asString(request?.requestType));
    const optionLabel =
      ELIGIBILITY_REQUEST_TYPE_OPTIONS.find((opt) => opt.value === requestType)?.label ??
      requestType;
    const status = asString(result?.status) || 'unknown';
    const inquiryDep = asString(request?.dependantCode);
    const familyMembers = parseStoredFamilyMembers(result?.familyMembers);
    const verifiedPatient = parseStoredFamilyMembers(
      result?.verifiedPatient ? [result.verifiedPatient] : [],
    )[0];
    const inquiryMatch = parseStoredInquiryMatch(result?.inquiryMatch);
    const key = `elig-${savedAt || 'entry'}-${status}-${idx}`;
    const isExpanded = expandedPatientHistoryKey === key;

    return (
      <div key={key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
        <button
          type="button"
          onClick={() => setExpandedPatientHistoryKey((prev) => (prev === key ? null : key))}
          className="w-full text-left"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">{optionLabel}</p>
            <span
              className={`rounded-full border bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
                status === 'eligible'
                  ? 'border-emerald-200 text-emerald-800'
                  : status === 'ineligible'
                    ? 'border-rose-200 text-rose-700'
                    : 'border-amber-200 text-amber-800'
              }`}
            >
              {status}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {savedAt ? new Date(savedAt).toLocaleString() : 'No timestamp'}
            {inquiryDep ? ` • Checked dep ${inquiryDep}` : ''}
          </p>
        </button>
        {isExpanded ? (
          <div className="mt-3 text-xs text-slate-700">
            {asString(result?.hnet) ? (
              <p>
                <span className="font-semibold text-slate-600">HNET:</span> {asString(result?.hnet)}
              </p>
            ) : null}
            {requestType === 'normal' && verifiedPatient ? (
              <VerifiedPatientPanel patient={verifiedPatient} />
            ) : null}
            {requestType === 'family' && familyMembers.length ? (
              <FamilyMembersPanel
                members={familyMembers}
                inquiryDependantCode={inquiryDep}
                inquiryMatch={inquiryMatch}
              />
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

  const buildEligibilityFromClaim = (
    claimPayload: BillingClaimCreatePayload,
    requestType: EligibilityRequestType = eligibilityRequestType,
  ): BillingEligibilityPayload => {
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
      requestType,
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

  const applyFamilyMemberToClaim = (member: FamilyMemberDto) => {
    setSubmitPayload((prev) => ({
      ...prev,
      patient: {
        ...prev.patient,
        dependantCode: member.dependantCode || prev.patient.dependantCode,
        firstName: member.firstName || prev.patient.firstName,
        lastName: member.lastName || prev.patient.lastName,
        dateOfBirth: member.dateOfBirth || prev.patient.dateOfBirth,
        idNumber: member.idNumber || prev.patient.idNumber,
        initials: member.initials || prev.patient.initials,
      },
    }));
  };

  const checkEligibilityForClaim = async () => {
    const requestPayload = compactEligibilityPayload(
      buildEligibilityFromClaim(submitPayload, eligibilityRequestType),
    );
    setLastEligibilityInquiryDep(requestPayload.dependantCode || '');
    const hasMemberNumber = !!(requestPayload.memberNumber ?? '').trim();
    const hasPatientId = !!requestPayload.patientIdNumber?.trim();
    const hasMemberOrId = hasMemberNumber || hasPatientId;
    const memberRequired = eligibilityRequiresMemberNumber(requestPayload.requestType);

    if (!requestPayload.serviceDate || !requestPayload.schemeCode?.trim() || !requestPayload.planCode?.trim()) {
      onToast('Eligibility needs service date, scheme code, and plan code.', 'error');
      return;
    }
    if (memberRequired && !hasMemberNumber) {
      onToast(
        `${selectedEligibilityOption.label} checks require a member number.`,
        'error',
      );
      return;
    }
    if (!memberRequired && !hasMemberOrId) {
      onToast('Eligibility needs either a member number or patient ID number.', 'error');
      return;
    }
    setClaimEligibilityLoading(true);
    setClaimEligibilityResult(null);
    try {
      const res = await billingCheckEligibility(requestPayload);
      setClaimEligibilityResult(res);
      setLastCheckedEligibilityType(requestPayload.requestType as EligibilityRequestType);

      const matchedMember = res.inquiryMatch?.matched ? res.inquiryMatch.member : undefined;
      const depEntered = requestPayload.dependantCode || '';
      if (matchedMember && depEntered && !dependantCodesEqual(depEntered, matchedMember.dependantCode)) {
        onToast(
          `FAMCHECK matched by ${res.inquiryMatch?.matchReason ?? 'inquiry'}; dependant updated to ${matchedMember.dependantCode}.`,
          'info',
        );
      }

      setSubmitPayload((prev) => {
        const basePatient = matchedMember
          ? {
              ...prev.patient,
              dependantCode: matchedMember.dependantCode || prev.patient.dependantCode,
              firstName: matchedMember.firstName || prev.patient.firstName,
              lastName: matchedMember.lastName || prev.patient.lastName,
              dateOfBirth: matchedMember.dateOfBirth || prev.patient.dateOfBirth,
              idNumber: matchedMember.idNumber || prev.patient.idNumber,
              initials: matchedMember.initials || prev.patient.initials,
            }
          : prev.patient;
        return {
          ...prev,
          hnet: res.hnet || prev.hnet,
          patient: {
            ...basePatient,
            planCode: res.planCode || requestPayload.planCode || basePatient.planCode,
            memberNumber:
              res.memberNumber || requestPayload.memberNumber || basePatient.memberNumber,
          },
        };
      });
      const hnetHint = res.hnet ? ` HNET ${res.hnet} saved for claim.` : '';
      const famHint =
        requestPayload.requestType === 'family' &&
        res.familyMembers?.length &&
        !res.inquiryMatch?.matched
          ? ' No dependant match — confirm ID or pick from roster.'
          : '';
      onToast(
        `Eligibility: ${res.status}.${hnetHint}${famHint}`,
        res.status === 'eligible' ? 'success' : 'info',
      );
      writeJson(LS_LAST_ELIGIBILITY, requestPayload);
      if (patient?.id) {
        await appendPatientBillingEligibility(patient.id, {
          savedAt: new Date().toISOString(),
          patientId: patient.id,
          eligibilityRequest: requestPayload,
          eligibilityResult: res,
        });
        await refreshPatientEligibility();
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
      const payloadWithHnet: BillingClaimCreatePayload = {
        ...payloadToSubmit,
        hnet: payloadToSubmit.hnet || claimEligibilityResult?.hnet,
      };
      const result = await billingSubmitClaim(payloadWithHnet);
      setLastClaimSubmitResult(result);
      const billable = resolveBillableCents(result);
      const statusLabel = formatClaimStatusLabel(result.status);
      const billableHint =
        typeof billable === 'number' ? ` Billable ${formatCents(billable)}.` : '';
      const hnetHint = result.hnet ? ` HNET ${result.hnet}.` : '';
      onToast(
        `Claim ${statusLabel}.${billableHint}${hnetHint}`,
        isClaimStatusBillable(result.status) ? 'success' : 'info',
      );
      writeJson(LS_LAST_SUBMIT, payloadWithHnet);
      if (result.transactionNumber) {
        const existing = readJson<Record<string, BillingClaimCreatePayload>>(LS_SUBMITTED_BY_TX) || {};
        existing[result.transactionNumber] = payloadWithHnet;
        writeJson(LS_SUBMITTED_BY_TX, existing);
      }

      if (patient?.id) {
        await appendPatientBillingClaim(patient.id, {
          savedAt: new Date().toISOString(),
          patientId: patient.id,
          claimRequest: payloadWithHnet,
          claimResult: result,
        });
        await refreshPatientClaims();
      }

      await refreshClaims();
    } catch (e) {
      onToast(e instanceof Error ? e.message : 'Failed to submit claim.', 'error');
    }
  };

  const loadReversalPayloadForTx = async (tx: string) => {
    const trimmed = tx.trim();
    if (!trimmed) {
      setSelectedReversalClaim(null);
      return;
    }

    const match = (claims || []).find((c) => c.transactionNumber === trimmed);
    if (match) setSelectedReversalClaim(match);

    const fromLocal =
      readJson<Record<string, BillingClaimCreatePayload>>(LS_SUBMITTED_BY_TX)?.[trimmed];
    if (fromLocal) {
      setReversalPayload(fromLocal);
      return;
    }

    if (!match?.id) return;

    try {
      const detail = await billingGetClaimById(match.id);
      setSelectedReversalClaim(detail);
      if (detail.requestPayload) {
        setReversalPayload(detail.requestPayload);
        onToast('Loaded original claim details for reversal.', 'info');
      }
    } catch {
      // Optional autofill. Reversal can still proceed using the most recent payload in state.
    }
  };

  const reverseClaim = async () => {
    if (!reversalTx.trim()) {
      const msg = 'Transaction number is required for reversal.';
      setReversalError(msg);
      onToast(msg, 'error');
      return;
    }
    setReversalLoading(true);
    setReversalError(null);
    try {
      const payloadFromSelected =
        selectedReversalClaim?.requestPayload &&
        selectedReversalClaim.transactionNumber === reversalTx.trim()
          ? selectedReversalClaim.requestPayload
          : null;
      const payloadToSubmit = compactClaimPayload(
        payloadFromSelected ?? reversalPayload,
      );
      const result = await billingReverseClaim({ ...payloadToSubmit, transactionNumber: reversalTx.trim() });
      if (result.status === 'rejected') {
        const mk =
          result.messages?.filter(Boolean).join('; ') ||
          'MediKredit rejected the reversal.';
        const msg = `Reversal rejected — ${mk}`;
        setReversalError(msg);
        onToast(msg, 'error');
      } else {
        setReversalError(null);
        onToast(
          `Reversal ${formatClaimStatusLabel(result.status)}.`,
          result.status === 'accepted' || result.status === 'partially_accepted'
            ? 'success'
            : 'info',
        );
      }
      if (expandedClaimId) {
        await selectAndLoadClaim(expandedClaimId);
      }
      await refreshClaims();
    } catch (e) {
      const msg = formatBillingError(e, 'Claim reversal failed');
      setReversalError(msg);
      onToast(msg, 'error');
    } finally {
      setReversalLoading(false);
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
              {(['list', 'submit', 'reverse', 'financials'] as ClaimsSubTab[]).map((name) => (
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
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent claims</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Label>Search by member number</Label>
                    <Input
                      value={claimsMemberSearchInput}
                      onChange={(e) => setClaimsMemberSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          applyClaimsMemberSearch();
                        }
                      }}
                      placeholder="e.g. MK1050533"
                    />
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <SmallButton onClick={applyClaimsMemberSearch} disabled={claimsLoading}>
                      Search
                    </SmallButton>
                    <SmallButton
                      variant="secondary"
                      onClick={clearClaimsMemberSearch}
                      disabled={claimsLoading || (!claimsMemberFilter && !claimsMemberSearchInput)}
                    >
                      Clear
                    </SmallButton>
                    {patient?.memberNumber || patient?.medicalAidNumber ? (
                      <SmallButton
                        variant="secondary"
                        onClick={() => {
                          const member =
                            patient.memberNumber || patient.medicalAidNumber || '';
                          setClaimsMemberSearchInput(member);
                          setClaimsMemberFilter(member);
                          void refreshClaims(member);
                        }}
                      >
                        Use patient
                      </SmallButton>
                    ) : null}
                  </div>
                </div>
                {claimsMemberFilter ? (
                  <p className="mt-2 text-xs text-slate-600">
                    Showing claims for member{' '}
                    <span className="font-semibold">{claimsMemberFilter}</span>
                  </p>
                ) : null}
              </div>
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
              <p className="text-sm text-slate-500">
                {claimsMemberFilter
                  ? `No claims found for member ${claimsMemberFilter}.`
                  : 'No claims found.'}
              </p>
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
                            Member: {c.memberNumber} • Plan: {c.planCode || '—'} • Tx:{' '}
                            {c.transactionNumber || '—'}
                            {typeof c.billableCents === 'number'
                              ? ` • Billable ${formatCents(c.billableCents)}`
                              : ''}
                            {c.reversalStatus ? ` • Reversal: ${c.reversalStatus}` : ''}
                          </p>
                        </button>
                        <div className="flex items-center gap-2">
                          <span
                            className={`shrink-0 rounded-full border bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${claimStatusBadgeClass(
                              c.status,
                              c.reversed,
                            )}`}
                          >
                            {c.reversed ? 'reversed' : formatClaimStatusLabel(c.status)}
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

        {subTab === 'financials' && (
          <div className="space-y-3">
            {claimsLoading && !claims ? (
              <p className="text-sm text-slate-500">Loading financials…</p>
            ) : (
              <PracticeFinancialsPanel claims={claims || []} />
            )}
            <p className="text-xs text-slate-500">
              Tip: this panel uses the loaded claim set (latest 50 claims). Adjust list loading limits if you need a wider reporting window.
            </p>
          </div>
        )}

        {subTab === 'list' && patient?.id && (
          <div className="mt-4 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Patient claim history</p>
                  <p className="text-sm font-semibold text-slate-800">{patient.name}</p>
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
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Patient eligibility history</p>
                  <p className="text-sm text-slate-600">FAMCHECK roster, verified patient, and inquiry match</p>
                </div>
                {patientEligibilityLoading ? (
                  <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                    <RefreshCw size={14} className="animate-spin" />
                    Loading…
                  </span>
                ) : null}
              </div>
              <div className="mt-3">
                {patientEligibilityChecks === null ? (
                  <p className="text-sm text-slate-500">Loading eligibility checks…</p>
                ) : recentPatientEligibility.length === 0 ? (
                  <p className="text-sm text-slate-500">No saved eligibility checks for this patient yet.</p>
                ) : (
                  <div className="space-y-2">
                    {recentPatientEligibility.map((entry, idx) =>
                      renderPatientEligibilityHistoryRecord(entry, idx),
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {subTab === 'submit' && (
          <div className="mt-1">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Submit new claim</p>
            <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Eligibility check</p>
                  <p className="text-sm text-slate-600">
                    Choose the MediKredit check type, then run eligibility against the current claim details.
                  </p>
                  <div className="mt-3 max-w-xl">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Check type
                    </label>
                    <select
                      value={eligibilityRequestType}
                      onChange={(e) =>
                        setEligibilityRequestType(
                          normalizeEligibilityRequestType(e.target.value),
                        )
                      }
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                    >
                      {ELIGIBILITY_REQUEST_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      {selectedEligibilityOption.description}
                      {selectedEligibilityOption.requiresMemberNumber
                        ? ' Member number is required for this check type.'
                        : ' Member number or patient ID number can be used for this check type.'}
                    </p>
                  </div>
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
                    <p className="font-semibold">
                      Status: {claimEligibilityResult.status}
                      {lastCheckedEligibilityType ? (
                        <span className="ml-2 font-normal text-slate-600">
                          (
                          {ELIGIBILITY_REQUEST_TYPE_OPTIONS.find(
                            (opt) => opt.value === lastCheckedEligibilityType,
                          )?.label ?? lastCheckedEligibilityType}
                          )
                        </span>
                      ) : null}
                    </p>
                    {claimEligibilityResult.hnet ? (
                      <p className="mt-1 text-xs">
                        <span className="font-semibold">HNET:</span> {claimEligibilityResult.hnet}
                        <span className="text-slate-600">
                          {' '}
                          (will be sent on claim submit)
                        </span>
                      </p>
                    ) : null}
                    {claimEligibilityResult.planCode ? (
                      <p className="mt-1 text-xs">
                        <span className="font-semibold">Plan:</span> {claimEligibilityResult.planCode}
                      </p>
                    ) : null}
                    {typeof claimEligibilityResult.dependantCount === 'number' ? (
                      <p className="mt-1 text-xs">
                        <span className="font-semibold">Dependants:</span>{' '}
                        {claimEligibilityResult.dependantCount}
                      </p>
                    ) : null}
                    {lastCheckedEligibilityType === 'normal' &&
                    claimEligibilityResult.verifiedPatient ? (
                      <VerifiedPatientPanel patient={claimEligibilityResult.verifiedPatient} />
                    ) : null}
                    {lastCheckedEligibilityType === 'family' &&
                    claimEligibilityResult.familyMembers?.length ? (
                      <FamilyMembersPanel
                        members={claimEligibilityResult.familyMembers}
                        inquiryDependantCode={lastEligibilityInquiryDep}
                        inquiryMatch={claimEligibilityResult.inquiryMatch}
                        onApplyMember={applyFamilyMemberToClaim}
                      />
                    ) : null}
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
            {lastClaimSubmitResult ? (
              <ClaimSubmitResultPanel result={lastClaimSubmitResult} />
            ) : null}
            {patient?.id && recentPatientEligibility.length > 0 ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Recent eligibility checks</p>
                <div className="mt-2 space-y-2">
                  {recentPatientEligibility.slice(0, 3).map((entry, idx) =>
                    renderPatientEligibilityHistoryRecord(entry, idx),
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {subTab === 'reverse' && (
          <div className="mt-1 space-y-4">
            {reversalError ? (
              <BillingErrorAlert
                title="Reversal failed"
                message={reversalError}
                onDismiss={() => setReversalError(null)}
              />
            ) : null}
            <p className="text-xs text-slate-500">
              Select a claim to reverse. Already-reversed claims are hidden from this list. Reversal uses the original
              stored claim details for that transaction.
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <Label>Select claim to reverse</Label>
                <select
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100"
                  value={reversalTx}
                  onChange={e => {
                    const tx = e.target.value;
                    setReversalTx(tx);
                    setReversalError(null);
                    if (!tx) {
                      setSelectedReversalClaim(null);
                      return;
                    }
                    void loadReversalPayloadForTx(tx);
                  }}
                >
                  <option value="">Select a claim…</option>
                  {reversalEligibleClaims.map(c => (
                    <option key={c.id} value={c.transactionNumber!}>
                      {c.transactionNumber} — {c.patientLastName || ''} ({c.memberNumber})
                    </option>
                  ))}
                </select>
                {reversalEligibleClaims.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    No reversible claims available. Submit a new claim first, or all loaded claims are already reversed.
                  </p>
                ) : null}
              </div>
              <div className="flex items-end">
                <SmallButton
                  onClick={reverseClaim}
                  variant="danger"
                  disabled={!reversalTx.trim() || reversalLoading}
                >
                  {reversalLoading ? 'Reversing…' : 'Reverse selected claim'}
                </SmallButton>
              </div>
            </div>
            {selectedReversalClaim ? (
              <div>
                <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                  Claim details for reversal
                </p>
                {renderClaimDetails(selectedReversalClaim)}
              </div>
            ) : (
              <p className="text-sm text-slate-500">No claim selected yet.</p>
            )}
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
          nappiCode: '',
          description: '',
          quantity: 1,
          baseTariffCents: 0,
          tariffPercent: 100,
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
              nappiCode: '',
              description: '',
              quantity: 1,
              baseTariffCents: 0,
              tariffPercent: 100,
              unitPriceCents: 0,
              totalPriceCents: 0,
              serviceDate: getTodayIsoDate(),
            },
          ],
    });
  };

  const totalClaimedCents = payload.lineItems.reduce(
    (sum, li) => sum + (Number(li.totalPriceCents) || 0),
    0,
  );
  const totalLineItems = payload.lineItems.length;
  const averageLineCents =
    totalLineItems > 0 ? Math.round(totalClaimedCents / totalLineItems) : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-cyan-100 bg-cyan-50/50 p-3">
        <Label>HNET (from eligibility)</Label>
        <Input
          value={payload.hnet || ''}
          onChange={(e) => onChange({ ...payload, hnet: e.target.value })}
          placeholder="Filled after eligibility check"
        />
        <p className="mt-1 text-xs text-slate-500">
          Sent to MediKredit as authorization on the claim. Run eligibility first, or paste HNET manually.
        </p>
      </div>

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
                      updateLineItem(idx, recalcLineItemFromTariff({
                        procedureCode: option.procedureCode,
                        description: option.description,
                        quantity: option.quantity,
                        baseTariffCents: option.unitPriceCents,
                        tariffPercent: 100,
                        unitPriceCents: option.unitPriceCents,
                        totalPriceCents: option.totalPriceCents,
                        nappiCode: option.nappiCode,
                        medicineQuantity: option.medicineQuantity ?? option.quantity,
                        serviceDate: li.serviceDate,
                      }));
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
                  <Label>Procedure code (tar_cd)</Label>
                  <Input value={li.procedureCode} onChange={e => updateLineItem(idx, { procedureCode: e.target.value })} placeholder="e.g. 0201 for NAPPI" />
                </div>
                <div>
                  <Label>NAPPI code (optional)</Label>
                  <Input
                    value={li.nappiCode || ''}
                    onChange={e => updateLineItem(idx, { nappiCode: e.target.value })}
                    placeholder="e.g. 472409018"
                  />
                </div>
                <div>
                  <Label>Medicine qty (optional)</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={li.medicineQuantity ?? li.quantity}
                    onChange={e =>
                      updateLineItem(idx, {
                        medicineQuantity: Number(e.target.value || li.quantity),
                      })
                    }
                  />
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
                    onChange={e =>
                      updateLineItem(
                        idx,
                        recalcLineItemFromTariff({
                          ...li,
                          quantity: Number(e.target.value || 1),
                        }),
                      )
                    }
                  />
                </div>
                <div>
                  <Label>Base tariff (cents)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={li.baseTariffCents ?? 0}
                    onChange={e =>
                      updateLineItem(
                        idx,
                        recalcLineItemFromTariff({
                          ...li,
                          baseTariffCents: Number(e.target.value || 0),
                        }),
                      )
                    }
                  />
                </div>
                <div>
                  <Label>Tariff % (max 300)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    value={li.tariffPercent ?? 100}
                    onChange={e =>
                      updateLineItem(
                        idx,
                        recalcLineItemFromTariff({
                          ...li,
                          tariffPercent: Number(e.target.value || 100),
                        }),
                      )
                    }
                  />
                </div>
                <div>
                  <Label>Unit price (cents)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={li.unitPriceCents}
                    onChange={e => updateLineItem(idx, { unitPriceCents: Number(e.target.value || 0) })}
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

      <div className="rounded-2xl border border-cyan-200 bg-cyan-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wider text-cyan-700">Financial Preview</p>
        <p className="mt-1 text-xs text-cyan-800">
          Key billing amounts that representatives usually verify during accreditation demos.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
          <FinancialMetric label="Claimed amount" value={formatMoneyOrDash(totalClaimedCents)} />
          <FinancialMetric label="Line items" value={String(totalLineItems)} />
          <FinancialMetric label="Average line value" value={formatMoneyOrDash(averageLineCents)} />
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

