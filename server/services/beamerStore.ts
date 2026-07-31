import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from '../config';
import type { BeamerProcessingStatus, BeamerReviewStatus, BeamerUploadSource } from '../../shared/types';

export interface BeamerPracticeConfigRow {
  practice_id: string;
  google_subject_email: string;
  patient_root_id: string | null;
  shared_drive_id: string | null;
  shared_drive_name: string | null;
  review_folder_id: string | null;
  provisioning_status: 'not_started' | 'provisioning' | 'ready' | 'failed';
  provisioning_error: string | null;
}

export interface BeamerDeviceRow {
  id: string;
  practice_id: string;
  display_name: string;
  platform: 'windows';
  agent_version: string | null;
  config_schema_version: number;
  enrolled_at: string;
  last_seen_at: string | null;
  last_sync_at: string | null;
  pending_upload_count: number;
  pending_review_count: number;
  revoked_at: string | null;
}

export interface BeamerAssetRow {
  id: string;
  practice_id: string;
  patient_id: string | null;
  device_id: string | null;
  drive_file_id: string;
  client_id: string;
  source: BeamerUploadSource;
  mime_type: string;
  byte_size: number;
  review_status: BeamerReviewStatus;
  processing_status: BeamerProcessingStatus;
  captured_at: string;
  review_reason_code: string | null;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface AuthenticatedBeamerDevice extends BeamerDeviceRow {
  config: BeamerPracticeConfigRow;
}

export interface EnrolledDevice {
  practiceId: string;
  deviceId: string;
  resumed: boolean;
}

export interface NewBeamerAsset {
  practiceId: string;
  patientId: string | null;
  deviceId?: string | null;
  driveFileId: string;
  clientId: string;
  source: BeamerUploadSource;
  mimeType: string;
  byteSize: number;
  reviewStatus: BeamerReviewStatus;
  processingStatus: BeamerProcessingStatus;
  capturedAt: string;
  uploadedByEmail?: string | null;
  reviewReasonCode?: string | null;
}

export interface BeamerStore {
  readonly configured: boolean;
  getPracticeConfig(practiceId: string): Promise<BeamerPracticeConfigRow | null>;
  beginProvisioning(practiceId: string, subjectEmail: string): Promise<void>;
  finishProvisioning(practiceId: string, driveId: string, driveName: string, reviewFolderId: string, patientRootId: string): Promise<void>;
  failProvisioning(practiceId: string, safeError: string): Promise<void>;
  createEnrollmentToken(input: {
    practiceId: string;
    tokenHash: string;
    createdByEmail: string;
    expiresAt: string;
  }): Promise<{ id: string }>;
  enrollDevice(input: {
    tokenHash: string;
    deviceTokenHash: string;
    installationId: string;
    displayName: string;
    agentVersion: string | null;
  }): Promise<EnrolledDevice | null>;
  getActiveDevice(practiceId: string): Promise<BeamerDeviceRow | null>;
  authenticateDevice(deviceTokenHash: string): Promise<AuthenticatedBeamerDevice | null>;
  recordHeartbeat(deviceId: string, agentVersion: string | null, configSchemaVersion: number, syncedAt: string | null, pendingUploadCount?: number, pendingReviewCount?: number): Promise<void>;
  verifyPatient(practiceId: string, patientId: string, subjectEmail: string, displayName?: string | null): Promise<void>;
  hasVerifiedPatient(practiceId: string, patientId: string): Promise<boolean>;
  getPatientNames(practiceId: string, patientIds: string[]): Promise<Record<string, string>>;
  insertAsset(input: NewBeamerAsset): Promise<BeamerAssetRow>;
  getAssetByClientId(practiceId: string, source: 'windows' | 'mobile', clientId: string): Promise<BeamerAssetRow | null>;
  getAsset(practiceId: string, assetId: string): Promise<BeamerAssetRow | null>;
  listAssets(practiceId: string, options: {
    patientId?: string;
    reviewStatus?: BeamerReviewStatus;
    limit: number;
  }): Promise<BeamerAssetRow[]>;
  updateReview(input: {
    practiceId: string;
    assetId: string;
    reviewStatus: 'approved' | 'rejected';
    reviewerEmail: string;
    patientId?: string;
  }): Promise<BeamerAssetRow | null>;
  beginApproval(input: {
    practiceId: string;
    assetId: string;
    patientId: string;
    reviewerEmail: string;
    approvalToken: string;
  }): Promise<BeamerAssetRow | null>;
  completeApproval(practiceId: string, assetId: string, approvalToken: string): Promise<BeamerAssetRow | null>;
  rollbackApproval(practiceId: string, assetId: string, approvalToken: string): Promise<BeamerAssetRow | null>;
}

export class SupabaseBeamerStore implements BeamerStore {
  readonly configured: boolean;
  private client: SupabaseClient | null;

  constructor(client?: SupabaseClient | null) {
    this.configured = Boolean(client || (config.supabaseUrl && config.supabaseServiceRoleKey));
    this.client = client === undefined && this.configured
      ? createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
          auth: { persistSession: false, autoRefreshToken: false },
          realtime: { transport: ws as never },
        })
      : client || null;
  }

  private db(): SupabaseClient {
    if (!this.client) throw new Error('Beamer data store is not configured.');
    return this.client;
  }

  private fail(operation: string, error: { message?: string } | null): never {
    console.error(`[beamerStore] ${operation} failed:`, error?.message || 'unknown database error');
    throw new Error('Beamer data operation failed.');
  }

  async getPracticeConfig(practiceId: string): Promise<BeamerPracticeConfigRow | null> {
    const { data, error } = await this.db().from('beamer_practice_config').select('*').eq('practice_id', practiceId).maybeSingle();
    if (error) this.fail('practice config lookup', error);
    return (data as BeamerPracticeConfigRow | null) || null;
  }

  async beginProvisioning(practiceId: string, subjectEmail: string): Promise<void> {
    const { error } = await this.db().from('beamer_practice_config').upsert({
      practice_id: practiceId,
      google_subject_email: subjectEmail.toLowerCase(),
      provisioning_status: 'provisioning',
      provisioning_error: null,
    }, { onConflict: 'practice_id' });
    if (error) this.fail('begin provisioning', error);
  }

  async finishProvisioning(practiceId: string, driveId: string, driveName: string, reviewFolderId: string, patientRootId: string): Promise<void> {
    const { error } = await this.db().from('beamer_practice_config').update({
      shared_drive_id: driveId,
      shared_drive_name: driveName,
      review_folder_id: reviewFolderId,
      patient_root_id: patientRootId,
      provisioning_status: 'ready',
      provisioning_error: null,
      provisioned_at: new Date().toISOString(),
    }).eq('practice_id', practiceId);
    if (error) this.fail('finish provisioning', error);
  }

  async failProvisioning(practiceId: string, safeError: string): Promise<void> {
    const { error } = await this.db().from('beamer_practice_config').update({
      provisioning_status: 'failed',
      provisioning_error: safeError.slice(0, 240),
    }).eq('practice_id', practiceId);
    if (error) this.fail('fail provisioning', error);
  }

  async createEnrollmentToken(input: {
    practiceId: string;
    tokenHash: string;
    createdByEmail: string;
    expiresAt: string;
  }): Promise<{ id: string }> {
    const { data, error } = await this.db().rpc('beamer_create_enrollment', {
      p_practice_id: input.practiceId,
      p_token_hash: input.tokenHash,
      p_created_by_email: input.createdByEmail,
      p_expires_at: input.expiresAt,
    });
    if (error || !data) this.fail('create enrollment token', error);
    return { id: String(data) };
  }

  async enrollDevice(input: {
    tokenHash: string;
    deviceTokenHash: string;
    installationId: string;
    displayName: string;
    agentVersion: string | null;
  }): Promise<EnrolledDevice | null> {
    const { data, error } = await this.db().rpc('beamer_enroll_device', {
      p_token_hash: input.tokenHash,
      p_device_token_hash: input.deviceTokenHash,
      p_installation_id: input.installationId,
      p_display_name: input.displayName,
      p_agent_version: input.agentVersion,
    });
    if (error) this.fail('enroll device', error);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.device_id) return null;
    return {
      practiceId: String(row.practice_id),
      deviceId: String(row.device_id),
      resumed: row.resumed === true,
    };
  }

  async getActiveDevice(practiceId: string): Promise<BeamerDeviceRow | null> {
    const { data, error } = await this.db().from('beamer_devices').select('*')
      .eq('practice_id', practiceId).is('revoked_at', null).maybeSingle();
    if (error) this.fail('active device lookup', error);
    return (data as BeamerDeviceRow | null) || null;
  }

  async authenticateDevice(deviceTokenHash: string): Promise<AuthenticatedBeamerDevice | null> {
    const { data, error } = await this.db().from('beamer_devices').select('*')
      .eq('device_token_hash', deviceTokenHash).is('revoked_at', null).maybeSingle();
    if (error) this.fail('device authentication', error);
    const device = (data as BeamerDeviceRow | null) || null;
    if (!device) return null;
    const entitlement = await this.db().from('practice_features').select('beamer')
      .eq('practice_id', device.practice_id).maybeSingle();
    if (entitlement.error) this.fail('device entitlement lookup', entitlement.error);
    if (entitlement.data?.beamer !== true) return null;
    const practiceConfig = await this.getPracticeConfig(device.practice_id);
    if (!practiceConfig || practiceConfig.provisioning_status !== 'ready') return null;
    return { ...device, config: practiceConfig };
  }

  async recordHeartbeat(deviceId: string, agentVersion: string | null, configSchemaVersion: number, syncedAt: string | null, pendingUploadCount = 0, pendingReviewCount = 0): Promise<void> {
    const patch: Record<string, unknown> = {
      last_seen_at: new Date().toISOString(),
      agent_version: agentVersion,
      config_schema_version: configSchemaVersion,
      pending_upload_count: Math.max(0, Math.min(Math.floor(pendingUploadCount), 100000)),
      pending_review_count: Math.max(0, Math.min(Math.floor(pendingReviewCount), 100000)),
    };
    if (syncedAt) patch.last_sync_at = syncedAt;
    const { error } = await this.db().from('beamer_devices').update(patch).eq('id', deviceId).is('revoked_at', null);
    if (error) this.fail('device heartbeat', error);
  }

  async verifyPatient(practiceId: string, patientId: string, subjectEmail: string, displayName?: string | null): Promise<void> {
    const { error } = await this.db().from('beamer_practice_patients').upsert({
      practice_id: practiceId,
      patient_id: patientId,
      verified_subject_email: subjectEmail.toLowerCase(),
      display_name: displayName?.slice(0, 200) || null,
      verified_at: new Date().toISOString(),
    }, { onConflict: 'practice_id,patient_id' });
    if (error) this.fail('patient verification save', error);
  }

  async hasVerifiedPatient(practiceId: string, patientId: string): Promise<boolean> {
    const { data, error } = await this.db().from('beamer_practice_patients').select('patient_id')
      .eq('practice_id', practiceId).eq('patient_id', patientId).maybeSingle();
    if (error) this.fail('patient verification lookup', error);
    return Boolean(data?.patient_id);
  }

  async getPatientNames(practiceId: string, patientIds: string[]): Promise<Record<string, string>> {
    if (patientIds.length === 0) return {};
    const { data, error } = await this.db().from('beamer_practice_patients').select('patient_id,display_name')
      .eq('practice_id', practiceId).in('patient_id', patientIds);
    if (error) this.fail('patient names lookup', error);
    return Object.fromEntries((data || []).filter((row) => row.display_name).map((row) => [String(row.patient_id), String(row.display_name)]));
  }

  async insertAsset(input: NewBeamerAsset): Promise<BeamerAssetRow> {
    const db = this.db();
    const existing = await db.from('beamer_assets').select('*')
      .eq('practice_id', input.practiceId).eq('drive_file_id', input.driveFileId).maybeSingle();
    if (existing.error) this.fail('asset idempotency lookup', existing.error);
    if (existing.data) return existing.data as BeamerAssetRow;

    const { data, error } = await db.from('beamer_assets').insert({
      practice_id: input.practiceId,
      patient_id: input.patientId,
      device_id: input.deviceId || null,
      drive_file_id: input.driveFileId,
      client_id: input.clientId,
      source: input.source,
      mime_type: input.mimeType,
      byte_size: input.byteSize,
      review_status: input.reviewStatus,
      processing_status: input.processingStatus,
      captured_at: input.capturedAt,
      uploaded_by_email: input.uploadedByEmail || null,
      review_reason_code: input.reviewReasonCode || null,
    }).select('*').single();
    if (error) {
      const retry = await db.from('beamer_assets').select('*')
        .eq('practice_id', input.practiceId).eq('source', input.source).eq('client_id', input.clientId).maybeSingle();
      if (!retry.error && retry.data) return retry.data as BeamerAssetRow;
      this.fail('asset insert', error);
    }
    if (!data) this.fail('asset insert', null);
    return data as BeamerAssetRow;
  }

  async getAssetByClientId(practiceId: string, source: 'windows' | 'mobile', clientId: string): Promise<BeamerAssetRow | null> {
    const { data, error } = await this.db().from('beamer_assets').select('*')
      .eq('practice_id', practiceId).eq('source', source).eq('client_id', clientId).maybeSingle();
    if (error) this.fail('asset client id lookup', error);
    return (data as BeamerAssetRow | null) || null;
  }

  async getAsset(practiceId: string, assetId: string): Promise<BeamerAssetRow | null> {
    const { data, error } = await this.db().from('beamer_assets').select('*')
      .eq('practice_id', practiceId).eq('id', assetId).maybeSingle();
    if (error) this.fail('asset lookup', error);
    return (data as BeamerAssetRow | null) || null;
  }

  async listAssets(practiceId: string, options: {
    patientId?: string;
    reviewStatus?: BeamerReviewStatus;
    limit: number;
  }): Promise<BeamerAssetRow[]> {
    let query = this.db().from('beamer_assets').select('*').eq('practice_id', practiceId)
      .order('captured_at', { ascending: false }).limit(options.limit);
    if (options.patientId) query = query.eq('patient_id', options.patientId);
    if (options.reviewStatus) query = query.eq('review_status', options.reviewStatus);
    const { data, error } = await query;
    if (error) this.fail('asset list', error);
    return (data || []) as BeamerAssetRow[];
  }

  async updateReview(input: {
    practiceId: string;
    assetId: string;
    reviewStatus: 'approved' | 'rejected';
    reviewerEmail: string;
    patientId?: string;
  }): Promise<BeamerAssetRow | null> {
    const patch: Record<string, unknown> = {
      review_status: input.reviewStatus,
      reviewed_by_email: input.reviewerEmail.toLowerCase(),
      reviewed_at: new Date().toISOString(),
    };
    if (input.patientId) patch.patient_id = input.patientId;
    const { data, error } = await this.db().from('beamer_assets').update(patch)
      .eq('practice_id', input.practiceId).eq('id', input.assetId)
      .eq('review_status', 'pending_review').eq('processing_status', 'ready')
      .select('*').maybeSingle();
    if (error) this.fail('asset review', error);
    return (data as BeamerAssetRow | null) || null;
  }

  async beginApproval(input: {
    practiceId: string;
    assetId: string;
    patientId: string;
    reviewerEmail: string;
    approvalToken: string;
  }): Promise<BeamerAssetRow | null> {
    const { data, error } = await this.db().from('beamer_assets').update({
      patient_id: input.patientId,
      reviewed_by_email: input.reviewerEmail.toLowerCase(),
      reviewed_at: input.approvalToken,
      processing_status: 'processing',
    }).eq('practice_id', input.practiceId).eq('id', input.assetId)
      .eq('review_status', 'pending_review').eq('processing_status', 'ready')
      .select('*').maybeSingle();
    if (error) this.fail('asset approval claim', error);
    return (data as BeamerAssetRow | null) || null;
  }

  async completeApproval(practiceId: string, assetId: string, approvalToken: string): Promise<BeamerAssetRow | null> {
    const { data, error } = await this.db().from('beamer_assets').update({
      review_status: 'approved',
      processing_status: 'ready',
    }).eq('practice_id', practiceId).eq('id', assetId)
      .eq('review_status', 'pending_review').eq('processing_status', 'processing')
      .eq('reviewed_at', approvalToken).select('*').maybeSingle();
    if (error) this.fail('asset approval completion', error);
    return (data as BeamerAssetRow | null) || null;
  }

  async rollbackApproval(practiceId: string, assetId: string, approvalToken: string): Promise<BeamerAssetRow | null> {
    const { data, error } = await this.db().from('beamer_assets').update({
      patient_id: null,
      reviewed_by_email: null,
      reviewed_at: null,
      processing_status: 'ready',
    }).eq('practice_id', practiceId).eq('id', assetId)
      .eq('review_status', 'pending_review').eq('processing_status', 'processing')
      .eq('reviewed_at', approvalToken).select('*').maybeSingle();
    if (error) this.fail('asset approval rollback', error);
    return (data as BeamerAssetRow | null) || null;
  }
}
