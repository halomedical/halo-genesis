import crypto from 'crypto';
import { Readable } from 'stream';
import { google, type drive_v3 } from 'googleapis';
import { config } from '../config';
import { assertDownloadableRasterMetadata } from './beamerValidation';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export interface PracticeDrive {
  driveId: string;
  driveName: string;
  reviewFolderId: string;
  patientRootId: string;
}

export interface PracticeDriveFile {
  id: string;
  driveId: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  parentIds: string[];
}

export interface DriveProvisioner {
  readonly configured: boolean;
  ensurePracticeDrive(input: {
    practiceId: string;
    practiceName: string;
    practiceUserEmail: string;
    existingDriveId?: string | null;
    existingPatientRootId?: string | null;
  }): Promise<PracticeDrive>;
  verifyPracticeFile(driveId: string, fileId: string): Promise<PracticeDriveFile | null>;
  verifySubjectPatient(subjectEmail: string, patientRootId: string, patientId: string): Promise<{ valid: boolean; displayName: string | null }>;
  uploadPracticeAsset(input: {
    drive: PracticeDrive;
    patientId: string;
    bytes: Buffer;
    mimeType: string;
    source: 'windows' | 'mobile';
    reviewStatus: 'pending_review' | 'approved';
    capturedAt: string;
  }): Promise<PracticeDriveFile>;
  moveReviewAsset(drive: PracticeDrive, fileId: string, destination: 'approved' | 'review'): Promise<boolean>;
  deletePracticeFile(driveId: string, fileId: string): Promise<void>;
  downloadPracticeFile(driveId: string, fileId: string): Promise<{ bytes: Buffer; mimeType: string }>;
}

export class UnconfiguredDriveProvisioner implements DriveProvisioner {
  readonly configured = false;

  private unavailable(): never {
    throw new Error('Beamer Workspace provisioning is not configured.');
  }

  async ensurePracticeDrive(): Promise<PracticeDrive> { return this.unavailable(); }
  async verifyPracticeFile(): Promise<PracticeDriveFile | null> { return this.unavailable(); }
  async verifySubjectPatient(): Promise<{ valid: boolean; displayName: string | null }> { return this.unavailable(); }
  async uploadPracticeAsset(): Promise<PracticeDriveFile> { return this.unavailable(); }
  async moveReviewAsset(): Promise<boolean> { return this.unavailable(); }
  async deletePracticeFile(): Promise<void> { return this.unavailable(); }
  async downloadPracticeFile(): Promise<{ bytes: Buffer; mimeType: string }> { return this.unavailable(); }
}

function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function stableRequestId(practiceId: string): string {
  const hex = crypto.createHash('sha256').update(`beamer:${practiceId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function generatedFileName(mimeType: string): string {
  const extensionByMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
  };
  const extension = extensionByMime[mimeType] || 'bin';
  return `beamer_${Date.now()}_${crypto.randomUUID()}.${extension}`;
}

export class GoogleWorkspaceDriveProvisioner implements DriveProvisioner {
  readonly configured = true;

  private auth(subject: string) {
    return new google.auth.JWT({
      email: config.beamerWorkspaceClientEmail,
      key: config.beamerWorkspacePrivateKey,
      scopes: [DRIVE_SCOPE],
      subject,
    });
  }

  private adminDrive(): drive_v3.Drive {
    return google.drive({ version: 'v3', auth: this.auth(config.beamerWorkspaceDelegatedSubject) });
  }

  private subjectDrive(subjectEmail: string): drive_v3.Drive {
    return google.drive({ version: 'v3', auth: this.auth(subjectEmail) });
  }

  private async resolvePatientRoot(
    subjectEmail: string,
    existingPatientRootId?: string | null
  ): Promise<string> {
    const drive = this.subjectDrive(subjectEmail);
    if (existingPatientRootId) {
      const existing = await drive.files.get({ fileId: existingPatientRootId, fields: 'id,mimeType,trashed' });
      if (existing.data.id && existing.data.mimeType === FOLDER_MIME_TYPE && !existing.data.trashed) return existing.data.id;
      throw new Error('Configured practice patient root is unavailable.');
    }
    const roots = await drive.files.list({
      spaces: 'drive',
      q: `name='Halo' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`,
      fields: 'files(id)',
      pageSize: 10,
    });
    const ids = (roots.data.files || []).map((file) => file.id).filter((id): id is string => Boolean(id));
    if (ids.length !== 1) throw new Error('A single canonical Halo patient root is required for Beamer provisioning.');
    return ids[0];
  }

  private async ensureMember(drive: drive_v3.Drive, driveId: string, email: string): Promise<void> {
    const existing = await drive.permissions.list({
      fileId: driveId,
      supportsAllDrives: true,
      useDomainAdminAccess: true,
      fields: 'permissions(id,emailAddress,type,role)',
    });
    if ((existing.data.permissions || []).some((permission) => permission.emailAddress?.toLowerCase() === email.toLowerCase())) {
      return;
    }
    await drive.permissions.create({
      fileId: driveId,
      supportsAllDrives: true,
      useDomainAdminAccess: true,
      sendNotificationEmail: false,
      requestBody: { type: 'user', role: 'organizer', emailAddress: email },
    });
  }

  private async ensureReviewFolder(drive: drive_v3.Drive, driveId: string): Promise<string> {
    const found = await drive.files.list({
      corpora: 'drive',
      driveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: `'${escapeDriveQuery(driveId)}' in parents and name='Review' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`,
      fields: 'files(id)',
      pageSize: 10,
    });
    const existingId = found.data.files?.[0]?.id;
    if (existingId) return existingId;

    const created = await drive.files.create({
      supportsAllDrives: true,
      fields: 'id',
      requestBody: { name: 'Review', mimeType: FOLDER_MIME_TYPE, parents: [driveId] },
    });
    if (!created.data.id) throw new Error('Google Drive did not return the Beamer Review folder ID.');
    return created.data.id;
  }

  async ensurePracticeDrive(input: {
    practiceId: string;
    practiceName: string;
    practiceUserEmail: string;
    existingDriveId?: string | null;
    existingPatientRootId?: string | null;
  }): Promise<PracticeDrive> {
    const drive = this.adminDrive();
    const desiredName = `Beamer - ${input.practiceName.trim() || 'Practice'}`.slice(0, 128);
    let driveId = input.existingDriveId || '';

    if (driveId) {
      const current = await drive.drives.get({ driveId, useDomainAdminAccess: true, fields: 'id,name' });
      if (!current.data.id) throw new Error('Configured Beamer Shared Drive no longer exists.');
      if (current.data.name !== desiredName) {
        await drive.drives.update({
          driveId,
          useDomainAdminAccess: true,
          requestBody: { name: desiredName },
        });
      }
    } else {
      const created = await drive.drives.create({
        requestId: stableRequestId(input.practiceId),
        requestBody: { name: desiredName },
      });
      driveId = created.data.id || '';
      if (!driveId) throw new Error('Google Drive did not return a Shared Drive ID.');
    }

    await this.ensureMember(drive, driveId, input.practiceUserEmail);
    const reviewFolderId = await this.ensureReviewFolder(drive, driveId);
    const patientRootId = await this.resolvePatientRoot(input.practiceUserEmail, input.existingPatientRootId);
    return { driveId, driveName: desiredName, reviewFolderId, patientRootId };
  }

  async verifyPracticeFile(driveId: string, fileId: string): Promise<PracticeDriveFile | null> {
    try {
      const response = await this.adminDrive().files.get({
        fileId,
        supportsAllDrives: true,
        fields: 'id,driveId,mimeType,size,createdTime,parents,trashed',
      });
      const file = response.data;
      if (!file.id || file.trashed || file.driveId !== driveId) return null;
      return {
        id: file.id,
        driveId,
        mimeType: file.mimeType || 'application/octet-stream',
        byteSize: Number(file.size || 0),
        createdAt: file.createdTime || new Date().toISOString(),
        parentIds: file.parents || [],
      };
    } catch (error) {
      const status = (error as { code?: unknown }).code;
      if (status === 404) return null;
      throw error;
    }
  }

  async verifySubjectPatient(subjectEmail: string, patientRootId: string, patientId: string): Promise<{ valid: boolean; displayName: string | null }> {
    const drive = this.subjectDrive(subjectEmail);
    try {
      const patient = await drive.files.get({
        fileId: patientId,
        fields: 'id,name,mimeType,parents,trashed',
      });
      const valid = Boolean(
        patient.data.id &&
        !patient.data.trashed &&
        patient.data.mimeType === FOLDER_MIME_TYPE &&
        (patient.data.parents || []).includes(patientRootId)
      );
      return { valid, displayName: valid ? (patient.data.name || null) : null };
    } catch (error) {
      if ((error as { code?: unknown }).code === 404) return { valid: false, displayName: null };
      throw error;
    }
  }

  async uploadPracticeAsset(input: {
    drive: PracticeDrive;
    patientId: string;
    bytes: Buffer;
    mimeType: string;
    source: 'windows' | 'mobile';
    reviewStatus: 'pending_review' | 'approved';
    capturedAt: string;
  }): Promise<PracticeDriveFile> {
    const response = await this.adminDrive().files.create({
      supportsAllDrives: true,
      fields: 'id,driveId,mimeType,size,createdTime,parents',
      requestBody: {
        name: generatedFileName(input.mimeType),
        parents: [input.reviewStatus === 'pending_review' ? input.drive.reviewFolderId : input.drive.driveId],
        appProperties: {
          beamerPatientId: input.patientId,
          beamerSource: input.source,
          beamerCapturedAt: input.capturedAt,
        },
      },
      media: { mimeType: input.mimeType, body: Readable.from(input.bytes) },
    });
    const file = response.data;
    if (!file.id || file.driveId !== input.drive.driveId) {
      throw new Error('Beamer upload did not land in the practice Shared Drive.');
    }
    return {
      id: file.id,
      driveId: input.drive.driveId,
      mimeType: file.mimeType || input.mimeType,
      byteSize: Number(file.size || input.bytes.length),
      createdAt: file.createdTime || new Date().toISOString(),
      parentIds: file.parents || [input.drive.driveId],
    };
  }

  async moveReviewAsset(drive: PracticeDrive, fileId: string, destination: 'approved' | 'review'): Promise<boolean> {
    const file = await this.verifyPracticeFile(drive.driveId, fileId);
    if (!file) throw new Error('Beamer file was not found in the practice Shared Drive.');
    const target = destination === 'approved' ? drive.driveId : drive.reviewFolderId;
    const source = destination === 'approved' ? drive.reviewFolderId : drive.driveId;
    if (file.parentIds.includes(target)) return false;
    await this.adminDrive().files.update({
      fileId,
      supportsAllDrives: true,
      addParents: target,
      removeParents: source,
      fields: 'id,parents',
    });
    return true;
  }

  async deletePracticeFile(driveId: string, fileId: string): Promise<void> {
    const file = await this.verifyPracticeFile(driveId, fileId);
    if (!file) return;
    await this.adminDrive().files.delete({ fileId, supportsAllDrives: true });
  }

  async downloadPracticeFile(driveId: string, fileId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const metadata = await this.verifyPracticeFile(driveId, fileId);
    if (!metadata) throw new Error('Beamer file was not found in the practice Shared Drive.');
    assertDownloadableRasterMetadata(metadata.mimeType, metadata.byteSize, config.beamerMaxFileUploadBytes);
    const response = await this.adminDrive().files.get(
      { fileId, supportsAllDrives: true, alt: 'media' },
      { responseType: 'arraybuffer' }
    );
    return { bytes: Buffer.from(response.data as ArrayBuffer), mimeType: metadata.mimeType };
  }
}

export function createDriveProvisioner(): DriveProvisioner {
  const ready = Boolean(
    config.beamerWorkspaceClientEmail &&
    config.beamerWorkspacePrivateKey &&
    config.beamerWorkspaceDelegatedSubject
  );
  return ready ? new GoogleWorkspaceDriveProvisioner() : new UnconfiguredDriveProvisioner();
}
