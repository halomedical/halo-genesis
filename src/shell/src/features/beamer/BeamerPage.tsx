import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Copy,
  Download,
  FileImage,
  FolderOpen,
  Images,
  Laptop,
  Loader2,
  MonitorCheck,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { Patient } from '../../../../../shared/types';
import {
  fetchBeamerOverview,
  fetchBeamerAssetContent,
  getBeamerFileMimeType,
  reviewBeamerUpload,
  startBeamerOnboarding,
  uploadBeamerMobileFiles,
  type BeamerEnrollment,
  type BeamerMobileSelection,
  type BeamerOverview,
  type BeamerUploadStatus,
  type BeamerUploadSummary,
} from '../../services/api';

type BeamerView = 'overview' | 'upload' | 'review';

interface BeamerPageProps {
  patients: Patient[];
  practiceName?: string | null;
  onBack: () => void;
  onToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const MAX_FILES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 15 * 1024 * 1024;
const ACCEPTED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const REVIEW_REASONS: Record<string, string> = {
  identifier_not_detected: 'The expected identifier was not detected on the medical image.',
  identifier_ambiguous: 'The identifier on the medical image could not be matched confidently.',
  manual_review: 'This image was sent for a manual safety check.',
};

const statusStyles: Record<BeamerUploadStatus, string> = {
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  review: 'border-amber-200 bg-amber-50 text-amber-700',
  rejected: 'border-slate-200 bg-slate-100 text-slate-600',
  failed: 'border-rose-200 bg-rose-50 text-rose-700',
  processing: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  uploading: 'border-blue-200 bg-blue-50 text-blue-700',
};

function formatWhen(value?: string | null): string {
  if (!value) return 'Not yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed);
}

function powerShellSingleQuote(value: string): string {
  return value.replace(/'/g, "''");
}

function UploadStatus({ status }: { status: BeamerUploadStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${statusStyles[status]}`}>
      {status === 'review' ? 'Needs review' : status}
    </span>
  );
}

function UploadRow({ upload, patientName }: { upload: BeamerUploadSummary; patientName?: string }) {
  const patientLabel = patientName || upload.patientName || 'Patient not matched';
  return (
    <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3.5 last:border-b-0 sm:px-5">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
        {upload.source === 'mobile' ? <Smartphone size={18} /> : <Laptop size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="truncate text-sm font-semibold text-slate-800">{patientLabel}</p>
          <UploadStatus status={upload.status} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {upload.itemCount} {upload.itemCount === 1 ? 'image' : 'images'} · {formatWhen(upload.capturedAt)} · {upload.source === 'mobile' ? 'Mobile' : 'Windows'}
        </p>
      </div>
    </div>
  );
}

function ReviewPreview({ assetId }: { assetId: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const objectUrlRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);

  useEffect(() => {
    return () => {
      requestGenerationRef.current += 1;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    };
  }, [assetId]);

  if (source) return <img src={source} alt="Medical image awaiting review" className="h-full w-full object-cover" />;
  return (
    <button
      type="button"
      disabled={loading}
      aria-label={failed ? 'Retry preview' : 'Load preview'}
      title={failed ? 'Retry preview' : 'Load preview'}
      className="flex h-full w-full items-center justify-center disabled:opacity-60"
      onClick={() => {
        const requestGeneration = ++requestGenerationRef.current;
        setLoading(true);
        setFailed(false);
        void fetchBeamerAssetContent(assetId).then((blob) => {
          const objectUrl = URL.createObjectURL(blob);
          if (requestGeneration !== requestGenerationRef.current) {
            URL.revokeObjectURL(objectUrl);
            return;
          }
          if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = objectUrl;
          setSource(objectUrlRef.current);
        }).catch(() => {
          if (requestGeneration === requestGenerationRef.current) setFailed(true);
        }).finally(() => {
          if (requestGeneration === requestGenerationRef.current) setLoading(false);
        });
      }}
    >
      {loading ? <Loader2 className="animate-spin" size={18} /> : failed ? <AlertCircle size={19} /> : <FileImage size={19} />}
    </button>
  );
}

function createMobileClientId(): string {
  if (typeof crypto.randomUUID === 'function') return `mobile-${crypto.randomUUID()}`;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `mobile-${Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export const BeamerPage: React.FC<BeamerPageProps> = ({ patients, practiceName, onBack, onToast }) => {
  const [view, setView] = useState<BeamerView>('overview');
  const [overview, setOverview] = useState<BeamerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<BeamerMobileSelection[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewPatientIds, setReviewPatientIds] = useState<Record<string, string>>({});
  const [startingOnboarding, setStartingOnboarding] = useState(false);
  const [enrollment, setEnrollment] = useState<BeamerEnrollment | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bootstrapCommand = useMemo(() => {
    const relativeUrl = enrollment?.bootstrapUrl || '/api/beamer/windows-installer/bootstrap';
    const bootstrapUrl = new URL(relativeUrl, window.location.origin).toString();
    const origin = window.location.origin;
    return `& ([scriptblock]::Create((irm '${powerShellSingleQuote(bootstrapUrl)}'))) -ApiBaseUrl '${powerShellSingleQuote(origin)}'`;
  }, [enrollment?.bootstrapUrl]);

  const loadOverview = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setLoadError(null);
    try {
      setOverview(await fetchBeamerOverview());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Beamer status could not be loaded.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const intervalId = window.setInterval(() => void loadOverview(true), 30_000);
    return () => window.clearInterval(intervalId);
  }, [loadOverview]);

  const filteredPatients = useMemo(() => {
    const term = patientSearch.trim().toLowerCase();
    if (!term) return patients;
    return patients.filter((patient) =>
      patient.name.toLowerCase().includes(term) ||
      patient.dob.toLowerCase().includes(term) ||
      (patient.folderNumber || '').toLowerCase().includes(term)
    );
  }, [patientSearch, patients]);

  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) || null;
  const activePracticeName = overview?.practiceName || practiceName || 'your practice';
  const device = overview?.device || null;

  const patientNameFor = (upload: BeamerUploadSummary): string | undefined =>
    upload.patientName || patients.find((patient) => patient.id === upload.patientId)?.name;

  const chooseUploadPatient = (patientId: string) => {
    if (patientId === selectedPatientId) return;
    if (selectedFiles.length > 0 && !window.confirm('Changing patient will clear the images currently selected for upload. Continue?')) {
      return;
    }
    if (selectedFiles.length > 0) setSelectedFiles([]);
    setSelectedPatientId(patientId);
  };

  const selectFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const files = Array.from(incoming);
    const next = [...selectedFiles];
    let totalBytes = next.reduce((sum, item) => sum + item.file.size, 0);
    let skipped = 0;
    for (const file of files) {
      const mimeType = getBeamerFileMimeType(file);
      if (!ACCEPTED_TYPES.has(mimeType) || file.size <= 0 || file.size > MAX_FILE_SIZE || next.length >= MAX_FILES || totalBytes + file.size > MAX_TOTAL_SIZE) {
        skipped += 1;
        continue;
      }
      next.push({ file, clientId: createMobileClientId() });
      totalBytes += file.size;
    }
    setSelectedFiles(next);
    if (skipped > 0) {
      onToast(`${skipped} item${skipped === 1 ? ' was' : 's were'} skipped. Choose 1–10 supported images, up to 10 MB each and 15 MB combined.`, 'error');
    }
  };

  const handleUpload = async () => {
    if (!selectedPatient) {
      onToast('Select a patient before adding images.', 'error');
      return;
    }
    if (selectedFiles.length === 0) {
      onToast('Choose at least one image.', 'error');
      return;
    }

    setUploading(true);
    try {
      await uploadBeamerMobileFiles(selectedPatient.id, selectedFiles);
      onToast(`${selectedFiles.length} item${selectedFiles.length === 1 ? '' : 's'} sent to ${selectedPatient.name}.`, 'success');
      setSelectedFiles([]);
      setSelectedPatientId('');
      setPatientSearch('');
      await loadOverview(true);
      setView('overview');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'The upload could not be completed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleReview = async (upload: BeamerUploadSummary, action: 'approve' | 'reject') => {
    const assignedPatientId = reviewPatientIds[upload.id] || upload.patientId || '';
    const assignedPatient = patients.find((patient) => patient.id === assignedPatientId);
    if (action === 'approve' && !assignedPatientId) {
      onToast('Assign this image to a patient before approval.', 'error');
      return;
    }
    const patientLabel = assignedPatient?.name || patientNameFor(upload) || 'this upload';
    const confirmed = window.confirm(
      action === 'approve'
        ? `Approve ${patientLabel} for the patient record and connected workflows?`
        : `Reject ${patientLabel}? It will leave the review queue but will not be permanently deleted.`
    );
    if (!confirmed) return;

    setReviewingId(upload.id);
    try {
      await reviewBeamerUpload(upload.id, action, action === 'approve' ? assignedPatientId : undefined);
      onToast(action === 'approve' ? 'Upload approved.' : 'Upload rejected and retained safely.', 'success');
      await loadOverview(true);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'The review decision could not be saved.', 'error');
    } finally {
      setReviewingId(null);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      onToast(`${label} copied.`, 'success');
    } catch {
      onToast(`Could not copy ${label.toLowerCase()}. Select and copy it manually.`, 'error');
    }
  };

  const handleStartOnboarding = async (replaceDevice = false) => {
    if (replaceDevice && !window.confirm('Replace the connected Windows device? The existing device will lose access.')) {
      return;
    }
    setStartingOnboarding(true);
    try {
      const result = await startBeamerOnboarding(replaceDevice);
      setEnrollment(result);
      onToast('Your private Beamer setup is being prepared.', 'success');
      await loadOverview(true);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Windows setup could not be started.', 'error');
    } finally {
      setStartingOnboarding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-[#f4f9fc]">
        <div className="text-center text-slate-500">
          <Loader2 className="mx-auto mb-3 animate-spin text-cyan-600" size={28} />
          <p className="text-sm font-medium">Loading Beamer…</p>
        </div>
      </div>
    );
  }

  if (loadError && !overview) {
    return (
      <div className="flex h-full flex-1 items-center justify-center bg-[#f4f9fc] px-5">
        <div className="w-full max-w-md rounded-3xl border border-rose-100 bg-white p-7 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 text-rose-500" size={30} />
          <h1 className="text-lg font-bold text-slate-900">Beamer is unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">{loadError}</p>
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={onBack} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 md:hidden">Back</button>
            <button type="button" onClick={() => void loadOverview()} className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-semibold text-white">
              <RefreshCw size={15} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-[#f4f9fc]">
      <header className="shrink-0 border-b border-slate-200/80 bg-white/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={onBack} aria-label="Back to navigation" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 md:hidden">
              <ChevronLeft size={21} />
            </button>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-sm shadow-cyan-700/20">
              <Images size={20} />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Beamer</h1>
              <p className="truncate text-xs text-slate-500 sm:text-sm">Medical images for {activePracticeName}</p>
            </div>
          </div>
          <button type="button" onClick={() => void loadOverview(true)} className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 transition hover:border-cyan-200 hover:text-cyan-700" aria-label="Refresh Beamer">
            <RefreshCw size={17} />
          </button>
        </div>
      </header>

      <div className="shrink-0 border-b border-slate-200/70 bg-white px-4 sm:px-6 lg:px-8">
        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto py-2" aria-label="Beamer sections">
          {([
            ['overview', 'Overview'],
            ['upload', 'Upload'],
            ['review', `Review${overview?.reviewQueue.length ? ` (${overview.reviewQueue.length})` : ''}`],
          ] as Array<[BeamerView, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setView(key)}
              className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition ${view === key ? 'bg-cyan-50 text-cyan-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <main className="custom-scrollbar flex-1 overflow-y-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="mx-auto max-w-7xl">
          {view === 'overview' && (
            <div className="space-y-5">
              <section className="grid gap-5 lg:grid-cols-[1.25fr_0.75fr]">
                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
                    <div className="flex gap-4">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${device?.status === 'online' ? 'bg-emerald-50 text-emerald-600' : device?.status === 'attention' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'}`}>
                        {device?.status === 'online' ? <Wifi size={22} /> : <WifiOff size={22} />}
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-bold text-slate-900">Windows connection</h2>
                          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${device?.status === 'online' ? 'bg-emerald-50 text-emerald-700' : device?.status === 'attention' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                            {device?.status || 'Not connected'}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-slate-500">{device?.displayName || 'No Windows workstation has been enrolled.'}</p>
                      </div>
                    </div>
                    {device && (
                      <button type="button" onClick={() => void handleStartOnboarding(true)} disabled={startingOnboarding} className="text-left text-xs font-semibold text-slate-500 hover:text-cyan-700 disabled:opacity-50 sm:text-right">
                        Replace device
                      </button>
                    )}
                  </div>
                  <div className="grid border-t border-slate-100 sm:grid-cols-3">
                    {[
                      ['Last sync', formatWhen(device?.lastSyncAt)],
                      ['Last seen', formatWhen(device?.lastSeenAt)],
                      ['Version', device?.agentVersion || 'Not installed'],
                    ].map(([label, value]) => (
                      <div key={label} className="border-b border-slate-100 px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
                        <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400">{label}</p>
                        <p className="mt-1.5 truncate text-sm font-semibold text-slate-700">{value}</p>
                      </div>
                    ))}
                  </div>
                  {device?.warnings && device.warnings.length > 0 && (
                    <div className="border-t border-amber-100 bg-amber-50/70 px-5 py-4">
                      <div className="flex gap-3">
                        <AlertCircle className="mt-0.5 shrink-0 text-amber-600" size={17} />
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Needs attention</p>
                          <ul className="mt-1.5 space-y-1 text-sm text-amber-800">
                            {device.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                          </ul>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <button type="button" onClick={() => setView('upload')} className="group rounded-3xl bg-gradient-to-br from-cyan-600 to-blue-700 p-6 text-left text-white shadow-sm shadow-cyan-800/20 transition hover:-translate-y-0.5 hover:shadow-lg">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15"><Camera size={21} /></div>
                  <h2 className="mt-5 text-lg font-bold">Upload from this device</h2>
                  <p className="mt-2 text-sm leading-6 text-cyan-50">Select a patient first, then take a photo or choose approved medical images.</p>
                  <span className="mt-5 inline-flex items-center gap-2 text-sm font-bold">Start upload <UploadCloud size={16} className="transition group-hover:translate-y-[-2px]" /></span>
                </button>
              </section>

              {(!device || enrollment) && (
                <section className="rounded-3xl border border-cyan-200 bg-white p-5 shadow-sm sm:p-6">
                  {!device && <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex gap-4">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700"><MonitorCheck size={22} /></div>
                      <div>
                        <h2 className="text-base font-bold text-slate-900">Set up Beamer on Windows</h2>
                        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">One Windows workstation can be connected to this practice. The guided installer asks which local or removable drive to watch and which identifier text to check—for example, Janet Johnson. Every Windows image still waits in Review for you to assign the patient.</p>
                      </div>
                    </div>
                    <button type="button" onClick={() => void handleStartOnboarding()} disabled={startingOnboarding} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60">
                      {startingOnboarding ? <Loader2 className="animate-spin" size={17} /> : <Download size={17} />}
                      Prepare Windows setup
                    </button>
                  </div>}
                  {enrollment && (
                    <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="flex gap-3"><ShieldCheck className="shrink-0 text-emerald-600" size={20} /><p className="text-sm text-emerald-800">Your private setup is ready{enrollment.expiresAt ? ` until ${formatWhen(enrollment.expiresAt)}` : ''}. The installer will ask for the setup code.</p></div>
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <div>
                          <label htmlFor="beamer-setup-code" className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">One-time setup code</label>
                          <div className="mt-1 flex gap-2">
                            <input id="beamer-setup-code" value={enrollment.enrollmentToken} readOnly className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 font-mono text-xs text-slate-700" />
                            <button type="button" onClick={() => void copyText(enrollment.enrollmentToken, 'Setup code')} aria-label="Copy one-time setup code" className="rounded-xl border border-emerald-200 bg-white p-2.5 text-emerald-700 hover:bg-emerald-100"><Copy size={16} /></button>
                          </div>
                        </div>
                        <div>
                          <label htmlFor="beamer-bootstrap-command" className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Windows PowerShell command</label>
                          <div className="mt-1 flex gap-2">
                            <input id="beamer-bootstrap-command" value={bootstrapCommand} readOnly className="min-w-0 flex-1 rounded-xl border border-emerald-200 bg-white px-3 py-2 font-mono text-xs text-slate-700" />
                            <button type="button" onClick={() => void copyText(bootstrapCommand, 'PowerShell command')} aria-label="Copy Windows PowerShell command" className="rounded-xl border border-emerald-200 bg-white p-2.5 text-emerald-700 hover:bg-emerald-100"><Copy size={16} /></button>
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-emerald-700">Run PowerShell as your normal Windows user. Enter the one-time setup code only when the verified installer asks for it.</p>
                    </div>
                  )}
                </section>
              )}

              <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="font-bold text-slate-900">Recent uploads</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Patient, time, count and status—original filenames stay hidden.</p>
                  </div>
                  <Clock3 className="text-slate-300" size={19} />
                </div>
                {overview?.recentUploads.length ? overview.recentUploads.map((upload) => <UploadRow key={upload.id} upload={upload} patientName={patientNameFor(upload)} />) : (
                  <div className="px-5 py-10 text-center"><Images className="mx-auto text-slate-300" size={28} /><p className="mt-3 text-sm font-medium text-slate-500">No Beamer uploads yet</p></div>
                )}
              </section>
            </div>
          )}

          {view === 'upload' && (
            <section className="mx-auto max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5 sm:p-6">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">Mobile upload</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Add images to a patient</h2>
                <p className="mt-2 text-sm text-slate-500">Choose the patient before taking or selecting any images.</p>
              </div>
              <div className="grid gap-0 lg:grid-cols-2">
                <div className="border-b border-slate-100 p-5 lg:border-b-0 lg:border-r sm:p-6">
                  <div className="mb-4 flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-600 text-xs font-bold text-white">1</span><h3 className="font-bold text-slate-800">Select patient</h3></div>
                  <input value={patientSearch} onChange={(event) => setPatientSearch(event.target.value)} placeholder="Search by patient, date of birth or folder" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-2 focus:ring-cyan-100" />
                  <div className="custom-scrollbar mt-3 max-h-72 space-y-1 overflow-y-auto">
                    {filteredPatients.map((patient) => (
                      <button key={patient.id} type="button" onClick={() => chooseUploadPatient(patient.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${selectedPatientId === patient.id ? 'bg-cyan-50 ring-1 ring-cyan-200' : 'hover:bg-slate-50'}`}>
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${selectedPatientId === patient.id ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{patient.name.slice(0, 2).toUpperCase()}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800">{patient.name}</span><span className="block text-xs text-slate-400">DOB {patient.dob}</span></span>
                        {selectedPatientId === patient.id && <Check size={17} className="text-cyan-700" />}
                      </button>
                    ))}
                    {filteredPatients.length === 0 && <p className="py-8 text-center text-sm text-slate-400">No matching patients</p>}
                  </div>
                </div>

                <div className={`p-5 transition sm:p-6 ${selectedPatient ? '' : 'opacity-50'}`}>
                  <div className="mb-4 flex items-center gap-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-600 text-xs font-bold text-white">2</span><h3 className="font-bold text-slate-800">Add images</h3></div>
                  {selectedPatient && (
                    <div className="mb-4 rounded-xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
                      <p className="font-bold">Confirm patient: {selectedPatient.name}</p>
                      <p className="mt-1 text-xs text-cyan-700">DOB {selectedPatient.dob} · {selectedPatient.sex === 'M' ? 'Male' : 'Female'}{selectedPatient.folderNumber ? ` · Folder ${selectedPatient.folderNumber}` : ''}</p>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    <button type="button" disabled={!selectedPatient} onClick={() => cameraInputRef.current?.click()} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 disabled:cursor-not-allowed"><Camera size={21} className="text-cyan-600" />Camera</button>
                    <button type="button" disabled={!selectedPatient} onClick={() => galleryInputRef.current?.click()} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 disabled:cursor-not-allowed"><Images size={21} className="text-cyan-600" />Gallery</button>
                    <button type="button" disabled={!selectedPatient} onClick={() => fileInputRef.current?.click()} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600 transition hover:border-cyan-300 hover:bg-cyan-50 disabled:cursor-not-allowed"><FolderOpen size={21} className="text-cyan-600" />Files</button>
                  </div>
                  <input ref={cameraInputRef} aria-label="Take a medical image" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" className="hidden" onChange={(event) => { selectFiles(event.target.files); event.currentTarget.value = ''; }} />
                  <input ref={galleryInputRef} aria-label="Choose medical images from gallery" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="hidden" onChange={(event) => { selectFiles(event.target.files); event.currentTarget.value = ''; }} />
                  <input ref={fileInputRef} aria-label="Choose medical images from files" type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif" multiple className="hidden" onChange={(event) => { selectFiles(event.target.files); event.currentTarget.value = ''; }} />
                  <div className="mt-4 space-y-2">
                    {selectedFiles.map(({ file, clientId }, index) => (
                      <div key={clientId} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                        <FileImage size={17} className="shrink-0 text-cyan-600" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-600">Selected item {index + 1} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
                        <button type="button" onClick={() => setSelectedFiles((files) => files.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove selected item ${index + 1}`} className="rounded-lg p-1 text-slate-400 hover:bg-white hover:text-rose-600"><X size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => void handleUpload()} disabled={!selectedPatient || selectedFiles.length === 0 || uploading} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
                    {uploading ? <Loader2 className="animate-spin" size={17} /> : <UploadCloud size={17} />}
                    {uploading ? 'Uploading securely…' : `Upload ${selectedFiles.length || ''} ${selectedFiles.length === 1 ? 'item' : 'items'}`}
                  </button>
                  <p className="mt-3 text-center text-[11px] leading-5 text-slate-400">JPEG, PNG, WebP, HEIC or HEIF; 1–10 images, up to 10 MB each and 15 MB combined. Final validation happens securely on the server.</p>
                </div>
              </div>
            </section>
          )}

          {view === 'review' && (
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-5 sm:p-6">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-600">Temporary review folder</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Review Windows uploads</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">Every Windows image waits here for explicit patient assignment and approval before it appears in patient records or Scopes. Identifier checks may add a reason, but do not select the patient. Rejecting an item removes it from the workflow but does not permanently delete it.</p>
              </div>
              {overview?.reviewQueue.length ? (
                <div className="divide-y divide-slate-100">
                  {overview.reviewQueue.map((upload) => (
                    <div key={upload.id} className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-amber-50 text-amber-600">
                          <ReviewPreview assetId={upload.id} />
                        </div>
                        <div className="min-w-0"><p className="truncate text-sm font-bold text-slate-800">{patientNameFor(upload) || 'Patient assignment required'}</p><p className="mt-1 text-xs text-slate-500">{upload.itemCount} {upload.itemCount === 1 ? 'item' : 'items'} · {formatWhen(upload.capturedAt)}</p>{upload.reason && <p className="mt-1 text-xs text-amber-700">{REVIEW_REASONS[upload.reason] || 'This medical image needs a manual safety check.'}</p>}</div>
                      </div>
                      <div className="flex flex-col gap-2 sm:w-72 sm:shrink-0">
                        <label htmlFor={`review-patient-${upload.id}`} className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Assign patient before approval</label>
                        <select id={`review-patient-${upload.id}`} value={reviewPatientIds[upload.id] || upload.patientId || ''} onChange={(event) => setReviewPatientIds((current) => ({ ...current, [upload.id]: event.target.value }))} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100">
                          <option value="">Select patient</option>
                          {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · DOB {patient.dob}{patient.folderNumber ? ` · ${patient.folderNumber}` : ''}</option>)}
                        </select>
                        <div className="flex gap-2">
                        <button type="button" disabled={reviewingId === upload.id} onClick={() => void handleReview(upload, 'reject')} className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 sm:flex-none">Reject</button>
                        <button type="button" disabled={reviewingId === upload.id || !(reviewPatientIds[upload.id] || upload.patientId)} onClick={() => void handleReview(upload, 'approve')} title={!(reviewPatientIds[upload.id] || upload.patientId) ? 'Assign this upload to a patient before approval' : undefined} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 sm:flex-none">{reviewingId === upload.id ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} Approve</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="px-5 py-14 text-center"><CheckCircle2 className="mx-auto text-emerald-500" size={32} /><p className="mt-3 font-semibold text-slate-700">Review queue is clear</p><p className="mt-1 text-sm text-slate-400">New Windows images will wait here for patient assignment and a decision.</p></div>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  );
};
