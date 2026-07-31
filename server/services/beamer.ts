import crypto from 'crypto';
import { config } from '../config';
import { createDriveProvisioner, type DriveProvisioner, type PracticeDrive } from './beamerDrive';
import {
  SupabaseBeamerStore,
  type AuthenticatedBeamerDevice,
  type BeamerAssetRow,
  type BeamerStore,
} from './beamerStore';
import {
  BeamerPayloadError,
  assertAssetContentAccess,
  assertHeartbeatSchemaVersion,
  decodeCanonicalBase64,
  resolveBeamerDeviceStatus,
  validateRasterBytes,
} from './beamerValidation';

const MOBILE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const AGENT_REASON_CODES = new Set(['identifier_not_detected', 'identifier_ambiguous', 'manual_review']);
const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class BeamerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function issueToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function safeDate(value: unknown, fallback = new Date()): string {
  if (typeof value !== 'string') return fallback.toISOString();
  const parsed = new Date(value);
  const now = Date.now();
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now + 5 * 60_000 || parsed.getTime() < now - 10 * 365 * 24 * 60 * 60_000) {
    throw new BeamerError('Invalid capture timestamp.', 400);
  }
  return parsed.toISOString();
}

function driveFromConfig(configRow: AuthenticatedBeamerDevice['config']): PracticeDrive {
  if (!configRow.shared_drive_id || !configRow.shared_drive_name || !configRow.review_folder_id || !configRow.patient_root_id) {
    throw new BeamerError('Beamer practice storage is not ready.', 503);
  }
  return {
    driveId: configRow.shared_drive_id,
    driveName: configRow.shared_drive_name,
    reviewFolderId: configRow.review_folder_id,
    patientRootId: configRow.patient_root_id,
  };
}

function uploadStatus(row: BeamerAssetRow): 'uploading' | 'processing' | 'approved' | 'review' | 'rejected' | 'failed' {
  if (row.processing_status === 'failed') return 'failed';
  if (row.review_status === 'pending_review') return 'review';
  if (row.review_status === 'rejected') return 'rejected';
  if (row.processing_status === 'uploading') return 'uploading';
  if (row.processing_status === 'processing') return 'processing';
  return 'approved';
}

function toUploadSummary(row: BeamerAssetRow, patientName: string | null = null) {
  return {
    id: row.id,
    patientId: row.patient_id,
    patientName,
    capturedAt: row.captured_at,
    source: row.source,
    itemCount: 1,
    status: uploadStatus(row),
    thumbnailUrl: null,
    reason: row.review_reason_code,
  };
}

function rethrowPayloadError(error: unknown): never {
  if (error instanceof BeamerPayloadError) throw new BeamerError(error.message, error.status);
  throw error;
}

export class BeamerService {
  constructor(
    private readonly store: BeamerStore = new SupabaseBeamerStore(),
    private readonly drive: DriveProvisioner = createDriveProvisioner(),
    private readonly now: () => Date = () => new Date()
  ) {}

  private ensureConfigured(): void {
    if (!this.store.configured) throw new BeamerError('Beamer data store is not configured.', 503);
  }

  private ensureDriveConfigured(): void {
    if (!this.drive.configured) throw new BeamerError('Beamer Workspace provisioning is not configured.', 503);
  }

  async overview(practice: { id: string; name: string }) {
    this.ensureConfigured();
    const [practiceConfig, device, recent, review] = await Promise.all([
      this.store.getPracticeConfig(practice.id),
      this.store.getActiveDevice(practice.id),
      this.store.listAssets(practice.id, { limit: 30 }),
      this.store.listAssets(practice.id, { reviewStatus: 'pending_review', limit: 30 }),
    ]);
    const actionableWarnings: string[] = [];
    if (practiceConfig?.provisioning_status === 'failed') actionableWarnings.push('Practice storage needs attention.');
    const status = resolveBeamerDeviceStatus({
      lastSeenAt: device?.last_seen_at || null,
      nowMs: this.now().getTime(),
      onlineThresholdMs: config.beamerOnlineThresholdSeconds * 1000,
      hasActionableWarning: actionableWarnings.length > 0,
    });
    const warnings = [...actionableWarnings];
    if (device && status === 'offline') warnings.push('Windows workstation is offline.');
    const patientIds = Array.from(new Set([...recent, ...review].map((row) => row.patient_id).filter((id): id is string => Boolean(id))));
    const patientNames = await this.store.getPatientNames(practice.id, patientIds);

    return {
      enabled: true,
      practiceName: practice.name,
      onboardingState: !practiceConfig ? 'not_started' : practiceConfig.provisioning_status === 'failed'
        ? 'attention' : practiceConfig.provisioning_status === 'ready' ? 'ready' : 'provisioning',
      device: device ? {
        id: device.id,
        displayName: device.display_name,
        status,
        platform: 'windows' as const,
        agentVersion: device.agent_version,
        lastSeenAt: device.last_seen_at,
        lastSyncAt: device.last_sync_at,
        warnings,
      } : null,
      recentUploads: recent.map((row) => toUploadSummary(row, row.patient_id ? patientNames[row.patient_id] || null : null)),
      reviewQueue: review.map((row) => toUploadSummary(row, row.patient_id ? patientNames[row.patient_id] || null : null)),
    };
  }

  async startOnboarding(input: {
    practice: { id: string; name: string };
    userEmail: string;
    replaceDevice: boolean;
  }) {
    this.ensureConfigured();
    this.ensureDriveConfigured();
    const activeDevice = await this.store.getActiveDevice(input.practice.id);
    if (activeDevice && !input.replaceDevice) {
      throw new BeamerError('This practice already has an active Windows workstation.', 409);
    }

    const current = await this.store.getPracticeConfig(input.practice.id);
    await this.store.beginProvisioning(input.practice.id, input.userEmail);
    try {
      const provisioned = await this.drive.ensurePracticeDrive({
        practiceId: input.practice.id,
        practiceName: input.practice.name,
        practiceUserEmail: input.userEmail,
        existingDriveId: current?.shared_drive_id,
        existingPatientRootId: current?.patient_root_id,
      });
      await this.store.finishProvisioning(
        input.practice.id,
        provisioned.driveId,
        provisioned.driveName,
        provisioned.reviewFolderId,
        provisioned.patientRootId
      );
    } catch {
      await this.store.failProvisioning(input.practice.id, 'Workspace provisioning failed.');
      throw new BeamerError('Could not provision this practice\'s Beamer storage.', 502);
    }

    const enrollmentToken = issueToken();
    const expiresAt = new Date(this.now().getTime() + config.beamerEnrollmentTtlMinutes * 60_000).toISOString();
    const enrollment = await this.store.createEnrollmentToken({
      practiceId: input.practice.id,
      tokenHash: hashToken(enrollmentToken),
      createdByEmail: input.userEmail,
      expiresAt,
    });
    return {
      status: 'ready' as const,
      enrollmentId: enrollment.id,
      enrollmentToken,
      // The bootstrap fetches the manifest and verifies SHA-256 before install.
      // Never expose the raw artifact as the onboarding download target.
      downloadUrl: null,
      bootstrapUrl: '/api/beamer/windows-installer/bootstrap',
      expiresAt,
    };
  }

  async enrollDevice(input: {
    contractVersion: number;
    enrollmentToken: string;
    installationId: string;
    displayName: string;
    agentVersion?: string | null;
  }) {
    this.ensureConfigured();
    const token = String(input.enrollmentToken || '');
    const displayName = String(input.displayName || '').trim().slice(0, 120);
    if (input.contractVersion !== 1 || token.length < 32 || !displayName || !INSTALLATION_ID_PATTERN.test(input.installationId)) {
      throw new BeamerError('Invalid enrollment request.', 400);
    }
    const deviceToken = issueToken();
    const enrolled = await this.store.enrollDevice({
      tokenHash: hashToken(token),
      deviceTokenHash: hashToken(deviceToken),
      installationId: input.installationId,
      displayName,
      agentVersion: String(input.agentVersion || '').trim().slice(0, 64) || null,
    });
    if (!enrolled) throw new BeamerError('Enrollment code is invalid, expired, or already used.', 401);
    return {
      deviceId: enrolled.deviceId,
      deviceToken,
      practiceId: enrolled.practiceId,
      contractVersion: 1,
      config: {
        configSchemaVersion: 3,
        uploadMode: 'proxy' as const,
        heartbeatIntervalSeconds: 60,
        maxUploadBytes: config.beamerMaxFileUploadBytes,
        endpoints: {
          heartbeat: '/api/beamer/agent/heartbeat',
          uploads: '/api/beamer/agent/files',
        },
      },
    };
  }

  async authenticateDevice(token: string): Promise<AuthenticatedBeamerDevice> {
    this.ensureConfigured();
    if (token.length < 32) throw new BeamerError('Invalid device credential.', 401);
    const device = await this.store.authenticateDevice(hashToken(token));
    if (!device) throw new BeamerError('Invalid or revoked device credential.', 401);
    return device;
  }

  async heartbeat(deviceToken: string, input: {
    contractVersion?: number;
    agentVersion?: string;
    configSchemaVersion?: number;
    syncedAt?: string;
    lastSyncedAt?: string;
    pendingUploadCount?: number;
    pendingReviewCount?: number;
  }) {
    const device = await this.authenticateDevice(deviceToken);
    if (input.contractVersion !== undefined && input.contractVersion !== 1) throw new BeamerError('Unsupported agent contract version.', 400);
    let configSchemaVersion: 3;
    try { configSchemaVersion = assertHeartbeatSchemaVersion(input.configSchemaVersion); } catch (error) { rethrowPayloadError(error); }
    const syncValue = input.lastSyncedAt || input.syncedAt;
    const syncedAt = syncValue ? safeDate(syncValue, this.now()) : null;
    await this.store.recordHeartbeat(
      device.id,
      String(input.agentVersion || '').slice(0, 64) || null,
      configSchemaVersion,
      syncedAt,
      Number(input.pendingUploadCount) || 0,
      Number(input.pendingReviewCount) || 0
    );
    return { ok: true, serverTime: this.now().toISOString(), configSchemaVersion };
  }

  async uploadAgentFile(deviceToken: string, input: {
    uploadId: string;
    patientId: string | null;
    mimeType: string;
    bytes: Buffer;
    capturedAt?: string;
    reviewStatus?: string;
    reviewReasonCode?: string;
  }) {
    const device = await this.authenticateDevice(deviceToken);
    this.ensureDriveConfigured();
    const drive = driveFromConfig(device.config);
    if (!CLIENT_ID_PATTERN.test(input.uploadId)) throw new BeamerError('Invalid upload ID.', 400);
    const existing = await this.store.getAssetByClientId(device.practice_id, 'windows', input.uploadId);
    if (existing) return { upload: toUploadSummary(existing) };
    if (input.patientId) {
      throw new BeamerError('Windows uploads require patient assignment in Beamer Review.', 400);
    }
    if (input.reviewStatus && input.reviewStatus !== 'pending_review') {
      throw new BeamerError('Windows uploads must enter Beamer Review.', 400);
    }
    if (!MOBILE_MIME_TYPES.has(input.mimeType) || input.bytes.length < 1 || input.bytes.length > config.beamerMaxFileUploadBytes) {
      throw new BeamerError('Unsupported or oversized image.', input.bytes.length > config.beamerMaxFileUploadBytes ? 413 : 415);
    }
    try { validateRasterBytes(input.mimeType, input.bytes); } catch (error) { rethrowPayloadError(error); }
    const patientId = null;
    const reviewStatus = 'pending_review' as const;
    const reason = input.reviewReasonCode?.trim() || null;
    if (reason && !AGENT_REASON_CODES.has(reason)) throw new BeamerError('Invalid review reason.', 400);

    const capturedAt = safeDate(input.capturedAt, this.now());
    const file = await this.drive.uploadPracticeAsset({
      drive, patientId: patientId || '', bytes: input.bytes, mimeType: input.mimeType,
      source: 'windows', reviewStatus, capturedAt,
    });
    try {
      const asset = await this.store.insertAsset({
        practiceId: device.practice_id, patientId, deviceId: device.id,
        driveFileId: file.id, clientId: input.uploadId, source: 'windows',
        mimeType: file.mimeType, byteSize: file.byteSize, reviewStatus,
        processingStatus: 'ready', capturedAt, reviewReasonCode: reason,
      });
      if (asset.drive_file_id !== file.id) await this.drive.deletePracticeFile(drive.driveId, file.id).catch(() => {});
      await this.store.recordHeartbeat(device.id, device.agent_version, 3, asset.captured_at);
      return { upload: toUploadSummary(asset) };
    } catch (error) {
      await this.drive.deletePracticeFile(drive.driveId, file.id).catch(() => {});
      throw error;
    }
  }

  async uploadMobile(input: {
    practiceId: string;
    userEmail: string;
    patientId: string;
    files: Array<{ clientId: string; mimeType: string; size: number; data: string }>;
  }) {
    this.ensureConfigured();
    this.ensureDriveConfigured();
    const practiceConfig = await this.store.getPracticeConfig(input.practiceId);
    if (!practiceConfig || practiceConfig.provisioning_status !== 'ready') {
      throw new BeamerError('Complete Beamer onboarding before uploading.', 409);
    }
    if (!input.patientId || input.files.length < 1 || input.files.length > 10) {
      throw new BeamerError('Select a patient and between 1 and 10 images.', 400);
    }
    const practiceDrive = driveFromConfig(practiceConfig);
    const patient = await this.drive.verifySubjectPatient(
      practiceConfig.google_subject_email,
      practiceDrive.patientRootId,
      input.patientId
    );
    if (!patient.valid) throw new BeamerError('Patient does not belong to this practice.', 403);
    await this.store.verifyPatient(input.practiceId, input.patientId, practiceConfig.google_subject_email, patient.displayName);
    const drive = practiceDrive;
    let totalBytes = 0;
    const decoded = input.files.map((file) => {
      if (!MOBILE_MIME_TYPES.has(file.mimeType)) throw new BeamerError('Unsupported image type.', 415);
      if (!CLIENT_ID_PATTERN.test(file.clientId)) throw new BeamerError('Invalid upload ID.', 400);
      let bytes: Buffer;
      try { bytes = decodeCanonicalBase64(file.data); } catch (error) { rethrowPayloadError(error); }
      if (bytes.length === 0 || bytes.length !== file.size) throw new BeamerError('Invalid image data.', 400);
      if (bytes.length > config.beamerMaxFileUploadBytes) throw new BeamerError('An image is too large.', 413);
      try { validateRasterBytes(file.mimeType, bytes); } catch (error) { rethrowPayloadError(error); }
      totalBytes += bytes.length;
      return { ...file, bytes };
    });
    if (totalBytes > config.beamerMaxMobileUploadBytes) throw new BeamerError('Mobile upload is too large.', 413);

    const uploads = [];
    for (const file of decoded) {
      const existing = await this.store.getAssetByClientId(input.practiceId, 'mobile', file.clientId);
      if (existing) {
        uploads.push(toUploadSummary(existing, patient.displayName));
        continue;
      }
      const capturedAt = this.now().toISOString();
      const stored = await this.drive.uploadPracticeAsset({
        drive,
        patientId: input.patientId,
        bytes: file.bytes,
        mimeType: file.mimeType,
        source: 'mobile',
        reviewStatus: 'approved',
        capturedAt,
      });
      try {
        const asset = await this.store.insertAsset({
          practiceId: input.practiceId, patientId: input.patientId,
          driveFileId: stored.id, clientId: file.clientId, source: 'mobile',
          mimeType: stored.mimeType, byteSize: stored.byteSize,
          reviewStatus: 'approved', processingStatus: 'ready', capturedAt,
          uploadedByEmail: input.userEmail,
        });
        if (asset.drive_file_id !== stored.id) await this.drive.deletePracticeFile(drive.driveId, stored.id).catch(() => {});
        uploads.push(toUploadSummary(asset, patient.displayName));
      } catch (error) {
        await this.drive.deletePracticeFile(drive.driveId, stored.id).catch(() => {});
        throw error;
      }
    }
    return { uploads };
  }

  async review(
    practiceId: string,
    assetId: string,
    input: { action: unknown; patientId?: unknown; patientName?: unknown },
    reviewerEmail: string
  ) {
    this.ensureConfigured();
    const action = input.action;
    if (action !== 'approve' && action !== 'reject') throw new BeamerError('Invalid review action.', 400);
    const current = await this.store.getAsset(practiceId, assetId);
    if (!current) throw new BeamerError('Upload was not found.', 404);
    const assignedPatientId = String(input.patientId || current.patient_id || '').trim();
    if (action === 'approve' && !assignedPatientId) throw new BeamerError('Assign a patient before approval.', 409);
    if (action === 'approve') {
      if (current.review_status === 'approved') {
        if (current.patient_id !== assignedPatientId) throw new BeamerError('Upload was already approved for another patient.', 409);
        return { upload: toUploadSummary(current) };
      }
      if (current.review_status !== 'pending_review') throw new BeamerError('Upload has already been reviewed.', 409);
      if (current.processing_status === 'processing' && current.patient_id !== assignedPatientId) {
        throw new BeamerError('Upload approval is already in progress for another patient.', 409);
      }
      if (!['ready', 'processing'].includes(current.processing_status)) {
        throw new BeamerError('Upload cannot be approved while it is being processed.', 409);
      }
      this.ensureDriveConfigured();
      const practiceConfig = await this.store.getPracticeConfig(practiceId);
      if (!practiceConfig) throw new BeamerError('Beamer practice storage is not ready.', 503);
      const drive = driveFromConfig(practiceConfig);
      if (!(await this.store.hasVerifiedPatient(practiceId, assignedPatientId))) {
        const patient = await this.drive.verifySubjectPatient(practiceConfig.google_subject_email, drive.patientRootId, assignedPatientId);
        if (!patient.valid) throw new BeamerError('Patient does not belong to this practice.', 403);
        await this.store.verifyPatient(practiceId, assignedPatientId, practiceConfig.google_subject_email, patient.displayName);
      }
      let approvalToken = current.processing_status === 'processing' ? current.reviewed_at : null;
      let ownsClaim = false;
      let claimed = current.processing_status === 'processing' && approvalToken ? current : null;
      if (!claimed) {
        approvalToken = this.now().toISOString();
        claimed = await this.store.beginApproval({
          practiceId,
          assetId,
          patientId: assignedPatientId,
          reviewerEmail,
          approvalToken,
        });
        ownsClaim = Boolean(claimed);
      }
      if (!claimed || !approvalToken) {
        const latest = await this.store.getAsset(practiceId, assetId);
        if (latest?.review_status === 'approved' && latest.patient_id === assignedPatientId) {
          return { upload: toUploadSummary(latest) };
        }
        if (latest?.review_status === 'pending_review' && latest.processing_status === 'processing' &&
            latest.patient_id === assignedPatientId && latest.reviewed_at) {
          claimed = latest;
          approvalToken = latest.reviewed_at;
        } else {
          throw new BeamerError('Upload approval is already in progress or complete.', 409);
        }
      }
      let movedByThisRequest = false;
      try {
        movedByThisRequest = await this.drive.moveReviewAsset(drive, claimed.drive_file_id, 'approved');
        const updated = await this.store.completeApproval(practiceId, assetId, approvalToken);
        if (!updated) {
          const latest = await this.store.getAsset(practiceId, assetId);
          if (latest?.review_status === 'approved' && latest.patient_id === assignedPatientId) {
            return { upload: toUploadSummary(latest) };
          }
          throw new BeamerError('Upload approval could not be completed.', 409);
        }
        return { upload: toUploadSummary(updated) };
      } catch (error) {
        const latest = await this.store.getAsset(practiceId, assetId).catch(() => null);
        if (latest?.review_status === 'approved' && latest.patient_id === assignedPatientId) {
          return { upload: toUploadSummary(latest) };
        }
        const ownsPendingClaim = ownsClaim && latest?.review_status === 'pending_review' &&
          latest.processing_status === 'processing' && latest.reviewed_at === approvalToken;
        if (ownsPendingClaim && movedByThisRequest) {
          await this.drive.moveReviewAsset(drive, claimed.drive_file_id, 'review');
        }
        if (ownsPendingClaim) await this.store.rollbackApproval(practiceId, assetId, approvalToken);
        throw error;
      }
    }
    if (current.review_status === 'rejected') return { upload: toUploadSummary(current) };
    if (current.review_status !== 'pending_review' || current.processing_status !== 'ready') {
      throw new BeamerError('Upload has already been reviewed or is being processed.', 409);
    }
    const updated = await this.store.updateReview({
      practiceId,
      assetId,
      reviewStatus: 'rejected',
      reviewerEmail,
      patientId: undefined,
    });
    if (!updated) throw new BeamerError('Upload has already been reviewed.', 409);
    return { upload: toUploadSummary(updated) };
  }

  async approvedAssets(practiceId: string, patientId: string) {
    this.ensureConfigured();
    if (!(await this.store.hasVerifiedPatient(practiceId, patientId))) {
      throw new BeamerError('Patient does not belong to this practice.', 403);
    }
    const rows = await this.store.listAssets(practiceId, { patientId, reviewStatus: 'approved', limit: 100 });
    return { assets: rows.filter((row) => row.processing_status === 'ready').map((row) => ({
      id: row.id,
      patientId: row.patient_id!,
      capturedAt: row.captured_at,
      source: row.source,
      status: 'approved' as const,
      thumbnailUrl: null,
      previewUrl: `/api/beamer/assets/${encodeURIComponent(row.id)}/content`,
      mimeType: row.mime_type,
    })) };
  }

  async assetContent(practiceId: string, assetId: string) {
    this.ensureConfigured();
    this.ensureDriveConfigured();
    const [asset, practiceConfig] = await Promise.all([
      this.store.getAsset(practiceId, assetId),
      this.store.getPracticeConfig(practiceId),
    ]);
    if (!asset || !practiceConfig?.shared_drive_id) {
      throw new BeamerError('Upload was not found.', 404);
    }
    try { assertAssetContentAccess(asset.review_status, asset.processing_status); } catch (error) { rethrowPayloadError(error); }
    try {
      return await this.drive.downloadPracticeFile(practiceConfig.shared_drive_id, asset.drive_file_id);
    } catch (error) {
      rethrowPayloadError(error);
    }
  }
}

let singleton: BeamerService | null = null;
export function getBeamerService(): BeamerService {
  singleton ||= new BeamerService();
  return singleton;
}
